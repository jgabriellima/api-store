// Phantombuster configuration {
"phantombuster command: nodejs"
"phantombuster package: 5"
"phantombuster dependencies: lib-StoreUtilities.js"

const { URL } = require("url")

const Buster = require("phantombuster")
const buster = new Buster()

const Puppeteer = require("puppeteer")

const StoreUtilities = require("./lib-StoreUtilities")
const utils = new StoreUtilities(buster)

const DB_NAME = "result"
// }

const isGithubUrl = url => {
	try {
		return (new URL(url)).hostname === "github.com"
	} catch (err) {
		return false
	}
}

const scrapeUser = () => {
	const profile = {}
	const profilePicture = document.querySelector("a[itemprop=\"image\"] img.avatar")
	const nameSelector = document.querySelector("div.vcard-names-container")
	const bioSelector = document.querySelector("div.user-profile-bio")
	const locationSelector = document.querySelector("ul.vcard-details li[itemprop=\"homeLocation\"]")
	const organizations = document.querySelectorAll("div.border-top a[data-hovercard-type=\"organization\"]")
	const organization = document.querySelector("ul.vcard-details li[itemprop=\"worksFor\"]")
	const emailSelector = document.querySelector("ul.vcard-details li[itemprop=\"email\"]")
	const accountCreationYear = document.querySelector("div.profile-timeline-year-list ul li:last-of-type")
	const pinnedRepos = document.querySelectorAll("li.pinned-repo-item")
	const commitsCount = document.querySelector("div.js-yearly-contributions h2")
	const websiteSelector = document.querySelector("li[itemprop=\"url\"] a")

	if (nameSelector) {
		const nickname = document.querySelector("div.vcard-names-container span.vcard-username")
		const name = document.querySelector("div.vcard-names-container span.vcard-fullname")
		profile.username = nickname ? nickname.textContent.trim() : null
		profile.fullname = name ? name.textContent.trim() : null
	}

	if (commitsCount) {
		const count = commitsCount.textContent.trim().match(/[\d,. ]+/g).filter(el => !isNaN(parseInt(el, 10))).pop().trim()
		profile.yearlyCommits = parseInt(count.replace(/[,. ]/g, ""), 10)
	}
	profile.pictureUrl = profilePicture ? profilePicture.src : null
	profile.bio = bioSelector ? bioSelector.textContent.trim() : null
	profile.worksFor = organization ? organization.textContent.trim() : null
	profile.organizations = [ ...organizations ].map(el => el.href)
	profile.location = locationSelector ? locationSelector.textContent.trim() : null
	profile.email = emailSelector ? emailSelector.textContent.trim() : null
	profile.website = websiteSelector ? websiteSelector.href : null

	if (emailSelector && emailSelector.querySelector("a")) {
		const isPrivate = emailSelector.querySelector("a").href
		profile.email = isPrivate.indexOf("/login?") > -1 ? null : profile.email
	}

	profile.createdYear = accountCreationYear ? parseInt(accountCreationYear.textContent.trim(), 10) : null
	profile.pinnedRepos = [ ...pinnedRepos ].map(el => el.querySelector("span.d-block a").href)

	const infos = [...document.querySelectorAll("nav a.UnderlineNav-item span.Counter")]

	for (const el of infos) {
		const name = [...el.parentNode.childNodes].filter(content => content.nodeType === Node.TEXT_NODE).map(el => el.textContent.trim()).filter(el => el).pop().toLowerCase()
		const data = parseInt(el.textContent.trim(), 10)
		profile[name] = data
	}

	return Promise.resolve(profile)
}

const openProfile = async (page, url) => {
	const response = await page.goto(url)

	if (response.status() !== 200) {
		throw `${url} responded with HTTP code ${response.status()}`
	}

	await page.waitForSelector("div.vcard-names-container", { timeout: 30000 })
	const profile = await page.evaluate(scrapeUser)
	profile.profileUrl = page.url()
	return profile
}

const scrapeHireStatus = async username => {
	let res = false
	try {
		const httpRes = await fetch(`https://api.github.com/users/${username}`)
		if (httpRes.status !== 200) {
			throw `Can't get hireable field: ${httpRes.status === 429 ? "Github rate limit" : "internal error"}`
		}
		const data = await httpRes.json()
		res = typeof data.hireable !== "boolean" ? false : data.hireable
	} catch (err) {
		res = err.message || err
	}
	return Promise.resolve(res)
}

;(async () => {
	const Browser = await Puppeteer.launch({ args: [ "--no-sandbox" ] })
	const Page = await Browser.newPage()
	let { spreadsheetUrl, columnName, numberOfLinesPerLaunch, queries, noDatabase, csvName, scrapeHireable } = utils.validateArguments()
	const profiles = []
	let db = null

	if (!csvName) {
		csvName = DB_NAME
	}

	if (spreadsheetUrl) {
		if (utils.isUrl(spreadsheetUrl)) {
			queries = isGithubUrl(spreadsheetUrl) ? [ spreadsheetUrl ] : await utils.getDataFromCsv2(spreadsheetUrl, columnName)
		} else {
			queries = [ spreadsheetUrl ]
		}
	}

	if (typeof queries === "string") {
		queries = [ queries ]
	}

	db = noDatabase ? [] : await utils.getDb(csvName + ".csv")
	queries = queries.filter(el => db.findIndex(line => line.query === el) < 0)

	if (typeof numberOfLinesPerLaunch === "number") {
		queries = queries.slice(0, numberOfLinesPerLaunch)
	}

	if (queries.length < 1) {
		utils.log("Input is empty OR every profiles are already scraped", "warning")
		process.exit()
	}

	for (const query of queries) {
		const timeLeft = await utils.checkTimeLeft()
		if (!timeLeft.timeLeft) {
			utils.log(timeLeft.message, "warning")
			break
		}
		utils.log(`Opening ${query}...`, "loading")
		const url = utils.isUrl(query) ? query : `https://www.github.com/${query}`
		let res = null
		try {
			res = await openProfile(Page, url)
			if (scrapeHireable) {
				const status = await Page.evaluate(scrapeHireStatus, res.username)
				if (typeof status === "string") {
					utils.log(status, "warning")
				} else {
					res.hireable = status
				}
			}
			res.query = query
			res.timestamp = (new Date()).toISOString()
			utils.log(`${query} scraped`, "done")
			profiles.push(res)
		} catch (err) {
			const error = `Error while scraping ${url}: ${err.message || err}`
			utils.log(error, "warning")
			profiles.push({ query, error, timestamp: (new Date()).toISOString() })
		}
	}
	db.push(...utils.filterRightOuter(db, profiles))
	await utils.saveResults(profiles, db, csvName, null)
	process.exit()
})()
.catch(err => {
	utils.log(`API execution error: ${err.message || err}`, "error")
	process.exit(1)
})
