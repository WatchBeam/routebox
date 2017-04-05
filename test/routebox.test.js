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

    afterEach(done => {
        clock.restore();
        server.stop(done);
    });

    describe('without LRU', () => {
        beforeEach(done => {
            server = new Hapi.Server();
            server.connection();
            server.register(require('../'), (err) => {
                expect(err).to.not.exist;

                server.start((err) => {
                    expect(err).to.not.exist;
                    clock = sinon.useFakeTimers();
                    done();
                });
            });
        });

        it('caches responses', done => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.result).to.equal(0);
                    expect(res2.statusCode).to.equal(200);
                    assertCached(res2);
                    done();
                });
            });
        });

        it('expires ttl correctly', done => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
                clock.tick(1001);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.result).to.equal(1);
                    expect(res2.statusCode).to.equal(200);
                    assertNotCached(res2);
                    done();
                });
            });
        });

        it('does not cache on routes without caching', done => {
            server.route({
                method: 'get', path: '/a',
                config: {
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.result).to.equal(1);
                    expect(res2.statusCode).to.equal(200);
                    assertNotCached(res2);
                    done();
                });
            });
        });

        it('does not cache on routes with private caching', done => {
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
            server.inject({ method: 'GET', url: '/b' }, (res) => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.result).to.equal(1);
                    expect(res2.statusCode).to.equal(200);
                    assertNotCached(res);

                    server.inject({ method: 'GET', url: '/a' }, (res3) => {
                        expect(res3.result).to.equal(2);
                        expect(res3.statusCode).to.equal(200);
                        assertNotCached(res3);
                        done();
                    });
                });
            });
        });

        it('does not cache not-ok responses', done => {
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
            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(res.statusCode).to.equal(500);
                assertNotCached(res);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.result).to.equal(2);
                    expect(res2.statusCode).to.equal(200);
                    assertNotCached(res2);
                    done();
                });
            });
        });

        it('respects reply.nocache', done => {
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
            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.result).to.equal(1);
                    expect(res2.statusCode).to.equal(200);
                    assertNotCached(res2);
                    done();
                });
            });
        });

        it('uses callback functions', done => {
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

            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(missCalled).to.equal(1);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(hitCalled).to.equal(1);
                    done();
                });
            });
        });
    });

    describe('with LRU', () => {
        let catbox;
        beforeEach(done => {
            catbox = sinon.createStubInstance(Catbox.Client);
            catbox.start.yields();
            catbox.validateSegmentName.returns(null);
            catbox.isReady.returns(true);
            function MockCacheCtor() {}
            MockCacheCtor.prototype = catbox;

            server = new Hapi.Server({ cache: MockCacheCtor });
            server.connection();
            server.register({
                register: require('../'),
                options: { lru: 128 },
            }, (err) => {
                expect(err).to.not.exist;

                server.start((err) => {
                    expect(err).to.not.exist;
                    clock = sinon.useFakeTimers();
                    done();
                });
            });
        });

        it('caches responses in the LRU cache', done => {
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
            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.result).to.equal(0);
                    expect(res2.statusCode).to.equal(200);
                    assertCached(res2);
                    done();
                });
            });
        });

        it('does not cache responses that are too big', done => {
            catbox.get.yields(null, null);

            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply('this string is far too long to fit in 16 bytes!'),
                },
            });

            let i = 0;
            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.statusCode).to.equal(200);
                    assertNotCached(res2);
                    done();
                });
            });
        });

        it('rejects old cached responses', done => {
            catbox.get.yields(null, null);

            server.route({
                method: 'get', path: '/a',
                config: {
                    cache: { expiresIn: 1000 },
                    handler: (req, reply) => reply(i++),
                },
            });

            let i = 0;
            server.inject({ method: 'GET', url: '/a' }, (res) => {
                expect(res.result).to.equal(0);
                expect(res.statusCode).to.equal(200);
                assertNotCached(res);
                clock.tick(1001);

                server.inject({ method: 'GET', url: '/a' }, (res2) => {
                    expect(res2.result).to.equal(1);
                    expect(res2.statusCode).to.equal(200);
                    assertNotCached(res2);
                    done();
                });
            });
        });
    });
});
