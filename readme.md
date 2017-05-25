# Routebox

[![Build Status](https://img.shields.io/travis/mixer/routebox.svg?style=flat-square)](https://travis-ci.org/mixer/routebox)

Routebox integrates with catbox to provide transparent route-level caching. It can work with zero configuration changes on your server.

## Usage

To Routebox, simply register it on your server.

```js
server.register(require('routebox'), function (err) {
    // ...
});
```

By default, all endpoints with the `cache` configured in their [route options](http://hapijs.com/api#route-options) and `privacy` set to `public` (or omitted; public is the default) will be cached. Routebox automatically hooks in to the `expiresAt`, `expiresIn`, and `statuses` options of the caching config.

These options are available when routebox is registered and can also be overridden on a per-route basis by passing in `config.plugins.routebox`:

 * `cache` corresponds to the cache name for response caches. Uses the server's default if not given.
 * `lru` when set, allows responses to be cached in-memory in _addition_ to the catbox cache. We try to serve responses from memory instead of the underlying cache when possible.
 * `enabled` whether to enable caching on the endpoint. Defaults to `true`, meaning all viable (see above) endpoints will be cached.
 * `digest` defaults to `sha1`, this is the algorithm used to digest the request for caching purposes. Other available options are: `md5`, `sha1`, `sha256`, `sha512`, `ripemd160`.
 * `segment` is the Catbox cache segment to store in. Defaults to `routebox`
 * `wasCachedHeader` header that gets sent down when we serve a cached response. Defaults to `X-Was-Cached`.
 * `parse` configures which parts of the request will be used to form the cache key:
    * `query` whether to include the query string. Defaults to `true`.
    * `method` whether to include the request method. Defaults to `true`.
    * `route` whether to include the route path. Defaults to `true`.
    * `headers` an object with keys that are the headers to include. Defaults to `{}`.
 * `callbacks` provides touch-points you can use to intercept the request and gather metrics. Each callback functions like a Hapi extension, taking the `(request, reply)` as arguments, after which you should call `reply.continue()`. These are called at the `onPreResponse` lifecycle point.
    * `onCacheHit` is called when a cached page is served.
    * `onCacheMiss` is called when a page that could be cached but is not (yet) is served.

If there's an endpoint that can sometimes provide private data, you can call `request.nocache()` to prevent Routebox from caching the request.
