// The service worker: lets the game open with no connection at all, once it's been opened
// online - on a plane, say, from the home screen. Pass-and-play and games against the computer
// need nothing else; only online play needs the internet.
//
// It keeps one version of the game in the browser's cache:
//  - the page (index.html) is fetched fresh whenever there's a connection, so a new deploy is
//    picked up straight away - and the copy kept is the one to fall back on offline;
//  - each version's Build files are saved alongside it. Their names are a hash of their
//    contents, so they never change - they're served from the cache, and once a newer page is
//    saved, the older version's files are deleted.
// Nothing here names the files: they're read out of the page itself, so it never needs editing
// for a new build.

const CACHE = "monodeal";
const PAGE = new URL("./", self.location).href;
const ALSO = ["manifest.webmanifest"];

self.addEventListener("install", (event) => {
  // Save the version that's live now, so even the first visit leaves the game playable offline.
  event.waitUntil(
    fetch(PAGE, { cache: "no-cache" })
      .then((page) => (page.ok ? saveVersion(page) : null))
      .catch(() => null)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return; // Relay, Unity's services and the like go straight to the network
  }
  event.respondWith(request.mode === "navigate" ? page(event) : file(request));
});

// The page: from the network if it can be reached (saving that version for offline), otherwise
// the copy saved last.
async function page(event) {
  try {
    // As it is: a navigation can't be fetched with options of its own.
    const response = await fetch(event.request);
    if (response.ok) {
      event.waitUntil(saveVersion(response.clone()).catch(() => {}));
    }
    return response;
  } catch (offline) {
    const saved = await caches.match(PAGE);
    if (saved) {
      return saved;
    }
    throw offline;
  }
}

// Anything else: the saved copy if there is one, otherwise the network - saving what comes back.
async function file(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, { ignoreSearch: true });
  if (saved) {
    return saved;
  }
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

// Saves a version of the game: the files the page loads first, then the page itself - so a
// saved page always has its whole build saved with it. Files already saved aren't fetched again.
// Then drops any build files the page doesn't use (an older version's).
async function saveVersion(pageResponse) {
  const html = await pageResponse.clone().text();
  const files = [...new Set(html.match(/Build\/[\w.\-]+/g) || [])].concat(ALSO);
  const urls = files.map((file) => new URL(file, PAGE).href);

  const cache = await caches.open(CACHE);
  for (const url of urls) {
    if (!(await cache.match(url))) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Couldn't save " + url);
      }
      await cache.put(url, response);
    }
  }
  await cache.put(PAGE, pageResponse);

  for (const request of await cache.keys()) {
    if (request.url.includes("/Build/") && !urls.includes(request.url)) {
      await cache.delete(request);
    }
  }
}
