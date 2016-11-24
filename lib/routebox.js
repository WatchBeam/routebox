'use strict';

const Hoek = require('hoek');
const Joi = require('joi');
const hash = require('es-hash');

const routebox = module.exports = {};

const schema = Joi.object({
    cache: Joi.string().required(),
    enabled: Joi.bool(),
    digest: Joi.string().allow('djb2', 'md5', 'sha1', 'sha256', 'sha512', 'ripemd160').required(),
    segment: Joi.string().required(),
    wasCachedHeader: Joi.string().required(),
    parse: Joi.object({
        query: Joi.bool(),
        method: Joi.bool(),
        route: Joi.bool(),
        headers: Joi.object(),
    }).required(),
    callback: Joi.object().required().keys({
        onCacheHit: Joi.func().required(),
        onCacheMiss: Joi.func().required(),
    }),
}).required();

function reqNoop(req, reply) { reply.continue(); }

routebox.register = function (server, options, next) {
    const defaults = Hoek.applyToDefaults({
        cache: '_default',
        enabled: true,
        digest: 'djb2',
        segment: 'routebox',
        wasCachedHeader: 'X-Was-Cached',
        parse: {
            query: true,
            method: true,
            route: true,
            headers: {},
        },
        callback: {
            onCacheHit: reqNoop,
            onCacheMiss: reqNoop,
        },
    }, options);

    Joi.assert(defaults, schema);

    /**
     * Checks if see if the request should be cached. If so, it return
     * cache settings to do so, otherwise returns undefined.
     * @param  {Hapi.Request} req
     * @return {Object}
     */
    function getSettings(req) {
        const cache = req.route.settings.cache;
        if ((!cache.expiresIn && !cache.expiresAt) ||
            (cache.privacy && cache.privacy !== 'public')) return undefined;

        let settings;
        const routeCfg = req.route.settings.plugins.routebox;
        if (routeCfg) {
            settings = Hoek.applyToDefaults(defaults, routeCfg);
        } else {
            settings = Hoek.clone(defaults);
        }

        if (!settings.enabled) return undefined;

        settings.expiresIn = cache.expiresIn;
        settings.expiresAt = cache.expiresAt;
        settings.statuses = cache.statuses;

        return settings;
    }

    /**
     * Logs an error associated with Routebox.
     * @param  {Error} err
     */
    function logError(err) {
        if (err) {
            server.log(['error', 'catbox', 'routebox'], err);
        }
    }

    /**
     * Creates a cache key for Catbox with the given ID and routebox settings.
     * @param  {String|Number} ident
     * @param  {Object}        segment
     * @return {Object}
     */
    function buildCacheKey(id, settings) {
        return { id: String(id), segment: settings.segment };
    }

    /**
     * Returns an object consisting of the given properties
     * taken from the source `object`.
     * @param  {Object} object
     * @param  {[]String} keys
     * @return {Object}
     */
    function pick(object, keys) {
        const output = {};
        keys.forEach((key) => { output[key] = object[key]; });
        return output;
    }

    server.ext('onPreHandler', (req, reply) => {
        const settings = getSettings(req);
        if (!settings) return reply.continue();

        // Create an identifying hash off what we were told to parse.
        const ident = hash({
            method: settings.parse.method && req.method,
            query: settings.parse.query && req.query,
            route: settings.parse.route && req.path,
            headers: Object.keys(settings.parse.headers || {}).reduce((headersHash, name) => {
                headersHash[name] = settings.parse.headers[name] && req.headers[name];
                return headersHash;
            }, {}),
        }, settings.digest);

        const policy = pick(settings, ['cache', 'segment', 'expiresIn', 'expiresAt']);
        policy.shared = true;
        const cache = server.cache(policy);

        req.plugins.routebox = { ident, cache };

        return cache._cache.get(buildCacheKey(ident, settings), (err, cached) => {
            if (err) {
                // If an error happens, log it, but don't fail the request. If
                // the cache goes down, we still want to at least *try* to
                // serve the request.
                logError(err);
                return reply.continue();
            }

            if (cached) {
                // Serve the cached response if we have one.
                const response = reply();
                Object.keys(cached.item).forEach((key) => {
                    response[key] = cached.item[key];
                });
                response.headers[settings.wasCachedHeader] = true;

                return response;
            }

            req.plugins.routebox = { ident, cache };
            return reply.continue();
        });
    });

    server.decorate('request', 'nocache', function () {
        this.plugins.routebox = { nocache: true };
    });

    server.ext('onPreResponse', (req, reply) => {
        const settings = getSettings(req);
        const rset = req.plugins.routebox;

        // If this route isn't cached or we called nocache on the request, don't do anything.
        if (!settings || !rset || rset.nocache) {
            return reply.continue();
        }

        // If we're already serving a cached request, we should not re-cache it.
        const response = req.response.output || req.response;
        if (response.headers[settings.wasCachedHeader]) {
            return settings.callback.onCacheHit(req, reply);
        }

        // If the response isn't a cach-able status code, abort too.
        if (settings.statuses.indexOf(response.statusCode) === -1) {
            return reply.continue();
        }

        // Otherwise go ahead and cache the response.
        rset.cache._cache.set(
            buildCacheKey(rset.ident, settings),
            pick(response, ['statusCode', 'headers', 'source', 'variety']),
            rset.cache.ttl(),
            logError
        );

        return settings.callback.onCacheMiss(req, reply);
    });

    next();
};

routebox.register.attributes = { pkg: require('../package') };
