/*
 * Darkpools service worker policy: which responses may be kept in the runtime cache.
 * A classic script shared by sw.js (importScripts) and the unit tests, so the
 * decision is testable without a service worker environment.
 *
 * Pages are per user and never cached, whatever their status: only the offline page
 * and static shell assets are stored, and nothing whose Cache-Control says no-store or
 * private. After sign-out the runtime cache is deleted as well.
 */
(function (root) {
  var SHELL_PATHS = ["/offline", "/icon.svg", "/favicon.ico", "/manifest.webmanifest", "/sw-policy.js"];

  function isShellAsset(pathname) {
    return pathname.indexOf("/_next/static/") === 0 || pathname.indexOf("/icons/") === 0 || SHELL_PATHS.indexOf(pathname) !== -1;
  }

  function forbidsCaching(cacheControl) {
    var value = String(cacheControl || "").toLowerCase();
    return value.indexOf("no-store") !== -1 || value.indexOf("private") !== -1;
  }

  /**
   * info: { ok, redirected, type, cacheControl, mode, pathname } describing a same-origin GET
   * response. Returns true only for the offline page (navigations) and shell assets.
   */
  function shouldCache(info) {
    if (!info || !info.ok || info.redirected) return false;
    if (info.type && info.type !== "basic") return false;
    if (forbidsCaching(info.cacheControl)) return false;
    if (info.mode === "navigate") return info.pathname === "/offline";
    return isShellAsset(info.pathname);
  }

  root.swPolicy = { SHELL_PATHS: SHELL_PATHS, isShellAsset: isShellAsset, forbidsCaching: forbidsCaching, shouldCache: shouldCache };
})(typeof self !== "undefined" ? self : globalThis);
