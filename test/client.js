// Load modules

var Code = require('code');
var Hapi = require('hapi');
var Lab = require('lab');
var Nes = require('../');


// Declare internals

var internals = {};


// Test shortcuts

var lab = exports.lab = Lab.script();
var describe = lab.describe;
var it = lab.it;
var expect = Code.expect;


describe('Browser', function () {

    describe('Client', function () {

        describe('connect()', function () {

            it('fails to connect', function (done) {

                var client = new Nes.Client('http://no.such.example.com');

                client.connect(function (err) {

                    expect(err).to.exist();
                    expect(err.message).to.match(/getaddrinfo ENOTFOUND/);
                    done();
                });
            });

            it('handles error before open events', function (done) {

                var client = new Nes.Client('http://no.such.example.com');
                client.onError = function (err) { };

                client.connect(function (err) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('test');
                    done();
                });

                client._ws.emit('error', new Error('test'));
                client._ws.emit('open');
            });
        });

        describe('disconnect()', function () {

            it('ignores when client not connected', function (done) {

                var client = new Nes.Client();

                client.disconnect();
                done();
            });

            it('ignores when client is disconnecting', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.disconnect();
                            client.disconnect();
                            server.stop(done);
                        });
                    });
                });
            });
        });

        describe('_reconnect()', function () {

            it('reconnects automatically', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var e = 0;
                        client.onError = function (err) {

                            ++e;
                        };

                        var c = 0;
                        client.onConnect = function () {

                            ++c;
                            if (c === 2) {
                                expect(e).to.equal(0);
                                client.disconnect();
                                server.stop(done);
                            }
                        };

                        expect(c).to.equal(0);
                        expect(e).to.equal(0);
                        client.connect({ delay: 10 }, function (err) {

                            expect(err).to.not.exist();

                            expect(c).to.equal(1);
                            expect(e).to.equal(0);

                            client._ws.close();
                        });
                    });
                });
            });

            it('does not reconnect automatically', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var e = 0;
                        client.onError = function (err) {

                            ++e;
                        };

                        var c = 0;
                        client.onConnect = function () {

                            ++c;
                        };

                        expect(c).to.equal(0);
                        expect(e).to.equal(0);
                        client.connect({ reconnect: false, delay: 10 }, function () {

                            expect(c).to.equal(1);
                            expect(e).to.equal(0);

                            client._ws.close();
                            setTimeout(function () {

                                expect(c).to.equal(1);
                                server.stop(done);
                            }, 15);
                        });
                    });
                });
            });

            it('overrides max delay', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var c = 0;
                        var now = Date.now();
                        client.onConnect = function () {

                            ++c;

                            if (c < 6) {
                                client._ws.close();
                                return;
                            }

                            expect(Date.now() - now).to.be.below(150);

                            client.disconnect();
                            server.stop(done);
                        };

                        client.connect({ delay: 10, maxDelay: 11 }, function () { });
                    });
                });
            });

            it('reconnects automatically (with errors)', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var url = 'http://localhost:' + server.info.port;
                        var client = new Nes.Client(url);

                        var e = 0;
                        client.onError = function (err) {

                            ++e;
                            client._url = 'http://localhost:' + server.info.port;
                        };

                        var c = 0;
                        client.onConnect = function () {

                            ++c;

                            if (c < 5) {
                                client._ws.close();

                                if (c === 3) {
                                    client._url = 'http://invalid';
                                }

                                return;
                            }

                            expect(e).to.equal(1);

                            client.disconnect();
                            server.stop(done);
                        };

                        expect(e).to.equal(0);
                        client.connect({ delay: 10, maxDelay: 15 }, function () { });
                    });
                });
            });

            it('errors on pending request when closed', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            setTimeout(function () {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Request failed - server disconnected');

                                server.stop(done);
                            });

                            client.disconnect();
                        });
                    });
                });
            });

            it('times out', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        server.connections[0].plugins.nes._listener._wss.handleUpgrade = function () { };

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var c = 0;
                        var now = Date.now();
                        client.onConnect = function () {

                            ++c;
                        };

                        var e = 0;
                        client.onError = function (err) {

                            ++e;
                            expect(err).to.exist();
                            expect(err.message).to.equal('Connection timed out');

                            if (e < 4) {
                                return;
                            }

                            expect(c).to.equal(0);
                            client.disconnect();
                            server.stop({ timeout: 1 }, done);
                        };

                        client.connect({ delay: 10, maxDelay: 10, timeout: 10 }, function (err) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Connection timed out');
                        });
                    });
                });
            });

            it('limits retries', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var c = 0;
                        var now = Date.now();
                        client.onConnect = function () {

                            ++c;
                            client._ws.close();
                        };

                        client.connect({ delay: 5, maxDelay: 10, retries: 2 }, function () {

                            setTimeout(function () {

                                expect(c).to.equal(3);
                                server.stop(done);
                            }, 100);
                        });
                    });
                });
            });

            it('aborts reconnect if disconnect is called in between attempts', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var c = 0;
                        client.onConnect = function () {

                            ++c;
                            client._ws.close();

                            if (c === 1) {
                                setTimeout(function () {

                                    client.disconnect();
                                }, 5);

                                setTimeout(function () {

                                    expect(c).to.equal(1);
                                    server.stop(done);
                                }, 15);
                            }
                        };

                        client.connect({ delay: 10 }, function () { });
                    });
                });
            });
        });

        describe('request()', function () {

            it('defaults to GET', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false, headers: '*' } }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.request({ path: '/' }, function (err, payload, statusCode, headers) {

                                expect(err).to.not.exist();
                                expect(payload).to.equal('hello');
                                expect(statusCode).to.equal(200);
                                expect(headers).to.contain({ 'content-type': 'text/html; charset=utf-8' });

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('errors when disconnected', function (done) {

                var client = new Nes.Client();

                client.request('/', function (err, payload, statusCode, headers) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Failed to send message - server disconnected');
                    done();
                });
            });

            it('errors on invalid payload', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'POST',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            var a = { b: 1 };
                            a.a = a;

                            client.request({ method: 'POST', path: '/', payload: a }, function (err, payload, statusCode, headers) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Converting circular structure to JSON');
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('errors on invalid data', { parallel: false }, function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'POST',
                        path: '/',
                        handler: function (request, reply) {

                            return reply('hello');
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client._ws.send = function () {

                                throw new Error('boom');
                            };

                            client.request({ method: 'POST', path: '/', payload: 'a' }, function (err, payload, statusCode, headers) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('boom');
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });
        });

        describe('message()', function () {

            it('errors on timeout', function (done) {

                var onMessage = function (socket, message, reply) {

                    setTimeout(function () {

                        return reply('hello');
                    }, 20);
                };

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { onMessage: onMessage } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port, { timeout: 10 });
                        client.connect(function () {

                            client.message('winning', function (err, response) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Request timed out');
                                expect(response).to.not.exist();

                                setTimeout(function () {

                                    client.disconnect();
                                    server.stop(done);
                                }, 20);
                            });
                        });
                    });
                });
            });
        });

        describe('_onMessage', function () {

            it('ignores invalid incoming message', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets.forEach(function (socket) {

                                socket._ws.send('{');
                            });

                            setTimeout(function () {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var logged;
                        client.onError = function (err) {

                            logged = err.message;
                        };

                        client.connect(function () {

                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(err).to.not.exist();
                                expect(logged).to.equal('Unexpected end of input');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('ignores incoming message with unknown id', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets.forEach(function (socket) {

                                socket._ws.send('{"id":100,"type":"response","statusCode":200,"payload":"hello","headers":{}}');
                            });

                            setTimeout(function () {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var logged;
                        client.onError = function (err) {

                            logged = err.message;
                        };

                        client.connect(function () {

                            client.request('/', function (err, payload, statusCode, headers) {

                                expect(err).to.not.exist();
                                expect(logged).to.equal('Received response for unknown request');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('ignores incoming message with unknown type', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.route({
                        method: 'GET',
                        path: '/',
                        handler: function (request, reply) {

                            request.connection.plugins.nes._listener._sockets.forEach(function (socket) {

                                socket._ws.send('{"id":2,"type":"unknown","statusCode":200,"payload":"hello","headers":{}}');
                            });

                            setTimeout(function () {

                                return reply('hello');
                            }, 10);
                        }
                    });

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        var logged;
                        client.onError = function (err) {

                            if (!logged) {
                                logged = err.message;
                                return;
                            }

                            expect(logged).to.equal('Received unknown response type: unknown');
                            expect(err.message).to.equal('Received response for unknown request');

                            client.disconnect();
                            server.stop(done);
                        };

                        client.connect(function () {

                            client.request('/', function (err, payload, statusCode, headers) { });
                        });
                    });
                });
            });
        });

        describe('subscribe()', function () {

            it('subscribes to a path', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.subscription('/', {});

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.subscribe('/', function (err, update) {

                                expect(client.subscriptions()).to.deep.equal(['/']);
                                expect(err).to.not.exist();
                                expect(update).to.equal('heya');
                                client.disconnect();
                                server.stop(done);
                            });

                            setTimeout(function () {

                                server.publish('/', 'heya');
                            }, 10);
                        });
                    });
                });
            });

            it('subscribes to a unknown path (pre connect)', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        client.subscribe('/b', function (err, update) {

                            expect(err).to.exist();
                            expect(err.message).to.equal('Not Found');
                            expect(err.statusCode).to.equal(404);
                            expect(client.subscriptions()).to.be.empty();

                            client.disconnect();
                            server.stop(done);
                        });

                        client.connect(function (err) { });
                    });
                });
            });

            it('subscribes to a path (pre connect)', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.subscription('/');

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);

                        client.subscribe('/', function (err, update) {

                            expect(err).to.not.exist();
                            expect(update).to.equal('heya');
                            client.disconnect();
                            server.stop(done);
                        });

                        client.connect(function (err) {

                            expect(err).to.not.exist();

                            setTimeout(function () {

                                server.publish('/', 'heya');
                            }, 10);
                        });
                    });
                });
            });

            it('manages multiple subscriptions', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.subscription('/');

                    server.start(function (err) {

                        var client1 = new Nes.Client('http://localhost:' + server.info.port);
                        var client2 = new Nes.Client('http://localhost:' + server.info.port);

                        client1.connect(function (err) {

                            expect(err).to.not.exist();
                            client2.connect(function (err) {

                                expect(err).to.not.exist();

                                client1.subscribe('/', function (err, update) {

                                    expect(err).to.not.exist();
                                    expect(update).to.equal('heya');
                                    client1.disconnect();
                                    server.stop(done);
                                });

                                client2.subscribe('/', function () { });

                                setTimeout(function () {

                                    client2.disconnect();
                                    setTimeout(function () {

                                        server.publish('/', 'heya');
                                    }, 10);
                                }, 10);
                            });
                        });
                    });
                });
            });

            it('ignores publish to a unknown path', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.subscription('/');

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.subscribe('/', function (err, update) { });
                            delete client._subscriptions['/'];

                            setTimeout(function () {

                                server.publish('/', 'heya');
                                setTimeout(function () {

                                    client.disconnect();
                                    server.stop(done);
                                }, 10);
                            }, 10);
                        });
                    });
                });
            });

            it('errors on unknown path', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.subscribe('/', function (err, update) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('Not Found');
                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('subscribes and immediately unsubscribe to a path (all handlers)', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client.subscribe('/', function (err, update) {

                                throw new Error('Must not be called');
                            });

                            client.unsubscribe('/');

                            setTimeout(function () {

                                client.disconnect();
                                server.stop(done);
                            }, 20);
                        });
                    });
                });
            });

            it('subscribes and immediately unsubscribe to a path (single handler)', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            var handler = function (err, update) {

                                throw new Error('Must not be called');
                            };

                            client.subscribe('/', handler);
                            client.unsubscribe('/', handler);

                            setTimeout(function () {

                                client.disconnect();
                                server.stop(done);
                            }, 20);
                        });
                    });
                });
            });

            it('subscribes and unsubscribes to a path before connecting', function (done) {

                var client = new Nes.Client('http://localhost');

                var handler1 = function () { };
                var handler2 = function () { };
                var handler3 = function () { };
                var handler4 = function () { };

                // Initial subscription

                client.subscribe('/', handler1);
                client.subscribe('/a', handler2);
                client.subscribe('/a/b', handler3);
                client.subscribe('/b/c', handler4);

                // Ignore duplicates

                client.subscribe('/', handler1);
                client.subscribe('/a', handler2);
                client.subscribe('/a/b', handler3);
                client.subscribe('/b/c', handler4);

                // Subscribe to some with additional handlers

                client.subscribe('/a', handler1);
                client.subscribe('/b/c', handler2);

                // Unsubscribe initial set

                client.unsubscribe('/', handler1);
                client.unsubscribe('/a', handler2);
                client.unsubscribe('/a/b', handler3);
                client.unsubscribe('/b/c', handler4);

                expect(client.subscriptions()).to.deep.equal(['/a', '/b/c']);
                done();
            });

            it('errors on subscribe fail', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false } }, function (err) {

                    expect(err).to.not.exist();

                    server.subscription('/');

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.connect(function () {

                            client._ws.send = function () {

                                throw new Error('failed');
                            };

                            client.subscribe('/', function (err, update) {

                                expect(err).to.exist();
                                expect(err.message).to.equal('failed');

                                client.disconnect();
                                server.stop(done);
                            });
                        });
                    });
                });
            });

            it('errors on missing path', function (done) {

                var client = new Nes.Client('http://localhost');

                client.subscribe('', function (err, update) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Invalid path');
                    done();
                });
            });

            it('errors on invalid path', function (done) {

                var client = new Nes.Client('http://localhost');

                client.subscribe('asd', function (err, update) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Invalid path');
                    done();
                });
            });
        });

        describe('unsubscribe()', function () {

            it('drops all handlers', function (done) {

                var client = new Nes.Client('http://localhost');

                var handler1 = function () { };
                var handler2 = function () { };

                client.subscribe('/a/b', handler1);
                client.subscribe('/a/b', handler2);

                client.unsubscribe('/a/b');

                expect(client.subscriptions()).to.be.empty();
                done();
            });

            it('ignores unknown path', function (done) {

                var client = new Nes.Client('http://localhost');

                var handler1 = function () { };
                var handler2 = function () { };

                client.subscribe('/a/b', handler1);
                client.subscribe('/b/c', handler2);

                client.unsubscribe('/a/b/c', handler1);
                client.unsubscribe('/b/c', handler1);

                expect(client.subscriptions()).to.deep.equal(['/a/b', '/b/c']);
                done();
            });

            it('errors on missing path', function (done) {

                var client = new Nes.Client('http://localhost');

                client.unsubscribe('', function (err, update) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Invalid path');
                    done();
                });
            });

            it('errors on invalid path', function (done) {

                var client = new Nes.Client('http://localhost');

                client.unsubscribe('asd', function (err, update) {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Invalid path');
                    done();
                });
            });
        });

        describe('_beat()', function () {

            it('disconnects when server fails to ping', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.onDisconnect = function () {

                            server.stop(done);
                        };

                        client.connect(function (err) {

                            expect(err).to.not.exist();

                            clearTimeout(server.connections[0].plugins.nes._listener._heartbeat);
                        });
                    });
                });
            });

            it('disconnects when server fails to ping (after a few pings)', function (done) {

                var server = new Hapi.Server();
                server.connection();
                server.register({ register: Nes, options: { auth: false, heartbeat: { interval: 20, timeout: 10 } } }, function (err) {

                    expect(err).to.not.exist();

                    server.start(function (err) {

                        var client = new Nes.Client('http://localhost:' + server.info.port);
                        client.onDisconnect = function () {

                            server.stop(done);
                        };

                        client.connect(function (err) {

                            expect(err).to.not.exist();

                            setTimeout(function () {

                                clearTimeout(server.connections[0].plugins.nes._listener._heartbeat);
                            }, 50);
                        });
                    });
                });
            });
        });
    });
});
