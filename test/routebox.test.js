'use strict';

const Hapi = require('hapi');
const Catbox = require('catbox');
const expect = require('chai').expect;
const sinon = require('sinon');

function assertCached(res) {
    expect(res.headers['x-was-cached']).to.exist;
}


function assertNotCached(res) {
    expect(res.headers['x-was-cached']).not.to.exist;
}

describe('routebox', function () {
    let server;
    let clock;

    afterEach(() => {
        clock.restore();
        return server.stop();
    });

    describe('without LRU', () => {
        beforeEach(() => {
            server = new Hapi.Server();
            server.connection();
            return server.register(require('../'))
            .then(() => server.start())
            .then(() => clock = sinon.useFakeTimers());
        });

        it('caches responses', () => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            return server.inject({ method: 'GET', url: '/a' })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertCached(res);
            });
        });

        it('expires ttl correctly', () => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            return server.inject({ method: 'GET', url: '/a' })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
                clock.tick(1001);
                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                    expect(res.result).to.equal(1);
                    expect(res.statusCode).to.equal(200);
                    assertNotCached(res);
            });
        });

        it('does not cache on routes without caching', () => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            return server.inject({ method: 'GET', url: '/a' })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.result).to.equal(1);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
            });
        });

        it('does not cache on routes with private caching', () => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000, privacy: 'private' },
                    handler: (req, reply) => reply(i++),
                },
            });

            server.route({
                method: 'get', path: '/{b}',
                config: {
                    cache: { expiresIn: 1000, privacy: 'private' },
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            return server.inject({ method: 'GET', url: '/b' })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.result).to.equal(1);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.result).to.equal(2);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
            });
        });

        it('does not cache not-ok responses', () => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000, privacy: 'private' },
                    handler: (req, reply) => {
                        i++;
                        if (i === 1) {
                            reply(new Error());
                        } else {
                            reply(i);
                        }
                    },
                },
            });

            let i = 0;

            return server.inject({ method: 'GET', url: '/a' })
            .then(res => {
                expect(res.statusCode).to.equal(500);
                assertNotCached(res);

                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.result).to.equal(2);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
            });
        });

        it('respects reply.nocache', () => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => {
                        req.nocache();
                        reply(i++);
                    },
                },
            });

            let i = 0;
            return server.inject({ method: 'GET', url: '/a' })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.result).to.equal(1);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
            });
        });

        it('uses callback functions', () => {
            let missCalled = 0;
            let hitCalled = 0;
            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: {
                        expiresIn: 1000,
                    },
                    plugins: {
                        routebox: {
                            callback: {
                                onCacheHit(req, reply) {
                                    hitCalled++;
                                    reply.continue();
                                },
                                onCacheMiss(req, reply) {
                                    missCalled++;
                                    reply.continue();
                                },
                            },
                        },
                    },
                    handler: (req, reply) => reply('ok'),
                },
            });

            return server.inject({ method: 'GET', url: '/a' })
            .then(() => {
                expect(missCalled).to.equal(1);
                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(() => expect(hitCalled).to.equal(1));
        });
    });

    describe('with LRU', () => {
        let catbox;
        beforeEach(() => {
            catbox = sinon.createStubInstance(Catbox.Client);
            catbox.start.yields();
            catbox.validateSegmentName.returns(null);
            catbox.isReady.returns(true);
            function MockCacheCtor() {}
            MockCacheCtor.prototype = catbox;

            server = new Hapi.Server({ cache: MockCacheCtor });
            server.connection();
            return server.register({
                register: require('../'),
                options: { lru: 128 },
            })
            .then(() => server.start())
            .then(() => clock = sinon.useFakeTimers());
        });

        it('caches responses in the LRU cache', () => {
            catbox.get.onCall(0).yields(null, null);
            catbox.get.throws(new Error('expected not to get subsequent calls'));

            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            return server.inject({ method: 'GET', url: '/a' })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertCached(res);
            });
        });

        it('does not cache responses that are too big', () => {
            catbox.get.yields(null, null);

            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply('this string is far too long to fit in 16 bytes!'),
                },
            });

            return server.inject({ method: 'GET', url: '/a' })
            .then(res => {
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
            });
        });

        it('rejects old cached responses', () => {
            catbox.get.yields(null, null);

            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            return server.inject({ method: 'GET', url: '/a' })
            .then(res => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
                clock.tick(1001);

                return server.inject({ method: 'GET', url: '/a' });
            })
            .then(res => {
                expect(res.result).to.equal(1);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
            });
        });
    });
});
