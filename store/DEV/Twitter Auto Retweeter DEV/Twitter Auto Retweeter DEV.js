// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js, lib-Twitter-DEV.js"
"phantombuster flags: save-folder"

const { URL } = require("url")

const Buster = require("phantombuster")
const buster = new Buster()

const Nick = require("nickjs")
const nick = new Nick({
	loadImages: true,
	printPageErrors: false,
	printResourceErrors: false,
	printNavigation: false,
	printAborts: false,
	debug: false,
})

const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(nick, buster)

const Twitter = require("./lib-Twitter-DEV")
const twitter = new Twitter(nick, buster, utils)

const DEFAULT_DB = "result"
const DEFAULT_RT = 1
// }

/**
 * @param {String} url
 * @return {Boolean}
 */
const isTwitterUrl = url => {
	try {
		return (new URL(url)).pathname.indexOf("twitter.com") > -1
	} catch (err) {
		return false
	}
}

/**
 * @param {Object} arg
 * @param {Function} cb
 * @return {Promise<Array<{ url: String, likes: Number, rt: Number, replies: Number }>>}
 */
const scrapeTweets = (arg, cb) => {
	const tweets = document.querySelectorAll("div.tweet.js-stream-tweet.js-actionable-tweet")
	const res = [ ...tweets ].map(tweet => {
		if (tweet.classList.contains("promoted-tweet")) {
			return null
		}
		const item = {}
		const likesSelector = tweet.querySelector("button.js-actionFavorite span[data-tweet-stat-count]")
		const rtSelector = tweet.querySelector("button.js-actionRetweet span[data-tweet-stat-count]")
		const repliesSelector = tweet.querySelector("button.js-actionReply span[data-tweet-stat-count]")
		item.url = `https://www.twitter.com${tweet.dataset.permalinkPath}`

		if (likesSelector) {
			item.likes = parseInt(likesSelector.dataset.tweetStatCount, 10)
		} else if (tweet.querySelector("button.js-actionFavorite span.ProfileTweet-actionCountForPresentation")) {
			item.likes = parseInt(tweet.querySelector("button.js-actionFavorite span.ProfileTweet-actionCountForPresentation").textContent.trim(), 10)
			isNaN(item.likes) && (item.likes = 0)
		} else {
			item.likes = 0
		}

		if (rtSelector) {
			item.rt = parseInt(rtSelector.dataset.tweetStatCount, 10)
		} else if (tweet.querySelector("button.js-actionRetweet span.ProfileTweet-actionCountForPresentation")) {
			item.rt = parseInt(tweet.querySelector("button.js-actionRetweet span.ProfileTweet-actionCountForPresentation").textContent.trim(), 10)
			isNaN(item.rt) && (item.rt = 0)
		} else {
			item.rt = 0
		}

		if (repliesSelector) {
			item.replies = parseInt(repliesSelector.dataset.tweetStatCount, 10)
		} else if (tweet.querySelector("button.js-actionReply span.ProfileTweet-actionCountForPresentation")) {
			item.replies = parseInt(tweet.querySelector("button.js-actionReply span.ProfileTweet-actionCountForPresentation").textContent.trim(), 10)
			isNaN(item.replies) && (item.replies = 0)
		} else {
			item.replies = 0
		}

		return item
	})
	cb(null, res.filter(el => el))
}

/**
 * TODO
 * @param {Object} tab
 * @param {String} url
 * @return {Promise<Boolean>}
 */
const retweet = async (tab, url) => {}

/**
 * @param {Object} tab
 * @param {Number} retweetCount
 * @return {Promise<Array<{ url: String, likes: Number, rt: Number, replies: Number }>>}
 */
const findRTs = async (tab, retweetCount) => {
	const loadedCount = await twitter.loadList(tab, retweetCount)
	utils.log(`${loadedCount} tweets loaded`, "done")
	return tab.evaluate(scrapeTweets)
}

;(async () => {
	const tab = await nick.newTab()
	let { sessionCookie, spreadsheetUrl, columnName, numberOfLinesPerLaunch, retweetsPerLaunch, csvName, queries } = utils.validateArguments()

	if (!csvName) {
		csvName = DEFAULT_DB
	}
	if (spreadsheetUrl) {
		if (utils.isUrl(spreadsheetUrl)) {
			queries = isTwitterUrl(spreadsheetUrl) ? [ spreadsheetUrl ] : await utils.getDataFromCsv2(spreadsheetUrl, columnName)
		} else {
			queries = [ spreadsheetUrl ]
		}
	}
	if (typeof retweetsPerLaunch !== "number") {
		retweetsPerLaunch = DEFAULT_RT
	}

	const db = utils.getDb(csvName)

	await twitter.login(tab, sessionCookie)
	utils.log(`Twitter profiles: ${JSON.stringify(queries, null, 2)}`, "info")
	for (const query of queries) {
		const processUrl = isTwitterUrl(query) ? query : `https://www.twitter.com/${query}`
		try {
			await twitter.openProfile(tab, processUrl)
		} catch (err) {
			utils.log(`Error while loading ${query}: ${err.message || err}`, "warning")
		}
		const tweets = await findRTs(tab, retweetsPerLaunch)
	}
	await utils.saveResults([], [], csvName, null)
	nick.exit()
})()
.catch(err => {
	utils.log(`API execution error: ${err.message || err}`, "error")
	console.log(err.stack || "no stack available")
	nick.exit(1)
})
