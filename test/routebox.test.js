const Hapi = require('hapi');
const expect = require('chai').expect;
const Timekeeper = require('timekeeper');

function assertCached(res) {
    expect(res.headers['x-was-cached']).to.exist;
}


function assertNotCached(res) {
    expect(res.headers['x-was-cached']).not.to.exist;
}

describe('routebox', function () {
    var server;
    beforeEach(function (done) {
        server = new Hapi.Server();
        server.connection();
        server.register(require('../'), (err) => {
            expect(err).to.not.exist;

            server.start((err) => {
              expect(err).to.not.exist;
              done();
            });
        });
    });

    afterEach(function (done) {
        server.stop(done);
    });

    it('caches responses', function (done) {
        server.route({
            method: 'get', path: '/a',
            config: {
                cache: { expiresIn: 1000 },
                handler: (req, reply) => reply(i++),
            },
        });

        var i = 0;
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

    it('expires ttl correctly', function (done) {
        server.route({
            method: 'get', path: '/a',
            config: {
                cache: { expiresIn: 1000 },
                handler: (req, reply) => reply(i++),
            },
        });

        var i = 0;
        server.inject({ method: 'GET', url: '/a' }, (res) => {
            expect(res.result).to.equal(0);
            expect(res.statusCode).to.equal(200);
            assertNotCached(res);
            Timekeeper.travel(Date.now() + 1001);

            server.inject({ method: 'GET', url: '/a' }, (res2) => {
                expect(res2.result).to.equal(1);
                expect(res2.statusCode).to.equal(200);
                assertNotCached(res2);
                done();
            });
        });
    });

    it('does not cache on routes without caching', function (done) {
        server.route({
            method: 'get', path: '/a',
            config: {
                handler: (req, reply) => reply(i++),
            },
        });

        var i = 0;
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

    it('does not cache on routes with private caching', function (done) {
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

        var i = 0;
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

    it('does not cache not-ok responses', function (done) {
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

        var i = 0;
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

    it('respects reply.nocache', function (done) {
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

        var i = 0;
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

    it('uses callback functions', function (done) {
        var missCalled = 0;
        var hitCalled = 0;
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

    it('respects config.plugins.routebox.parse.query = false', function(done) {
        server.route({
            method: 'get', path: '/a',
            config: {
                cache: { expiresIn: 1000 },
                handler: (req, reply) => {
                    reply(i++);
                },
                plugins: {
                    routebox: {
                        parse: {
                            query: false,
                        },
                    },
                },
            },
        });

        var i = 0;
        server.inject({ method: 'GET', url: '/a?=0' }, (res) => {
            expect(res.result).to.equal(0);
            expect(res.statusCode).to.equal(200);
            assertNotCached(res);

            server.inject({ method: 'GET', url: '/a?=1' }, (res2) => {
                expect(res2.result).to.equal(0);
                expect(res2.statusCode).to.equal(200);
                assertCached(res2);
                done();
            });
        });
    });

    it('respects config.plugins.routebox.parse.route = false', function(done) {
        server.route({
            method: 'get', path: '/a/{b}',
            config: {
                cache: { expiresIn: 1000 },
                handler: (req, reply) => {
                    reply(i++);
                },
                plugins: {
                    routebox: {
                        parse: {
                            route: false,
                        },
                    },
                },
            },
        });

        var i = 0;
        server.inject({ method: 'GET', url: '/a/x' }, (res) => {
            expect(res.result).to.equal(0);
            expect(res.statusCode).to.equal(200);
            assertNotCached(res);

            server.inject({ method: 'GET', url: '/a/y' }, (res2) => {
                expect(res2.result).to.equal(0);
                expect(res2.statusCode).to.equal(200);
                assertCached(res2);
                done();
            });
        });
    });

    it('respects config.plugins.routebox.parse.method = false', function(done) {
        server.route({
            method: ['put', 'get'], path: '/a',
            config: {
                cache: { expiresIn: 1000 },
                handler: (req, reply) => {
                    reply(i++);
                },
                plugins: {
                    routebox: {
                        parse: {
                            method: false,
                        },
                    },
                },
            },
        });

        var i = 0;
        server.inject({ method: 'PUT', url: '/a' }, (res) => {
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
});
