/* global describe it */
/* eslint no-new: 0 */

var assert = require('assert')

var bitcore = require('bitcore')
var session = require('../lib/session')
var fixtures = require('./fixtures/session')
var globals = require('./fixtures/globals')

var Transaction = bitcore.Transaction
var PrivateKey = bitcore.PrivateKey
var Session = session.Session
var network = bitcore.Networks.testnet

describe('Session', function () {
  it('performs a simple non-deterministic chat', function () {
    // TODO: I believe we should pass an object to the Session that is used to
    // query the blockchain (either as a key in options, or argument)
    testerPrivateKey = PrivateKey.fromWIF(globals.testerPrivateKey)
    tester2PrivateKey = PrivateKey.fromWIF(globals.tester2PrivateKey)

    var buyer_to_seller = new Session(testerPrivateKey,
      fixtures.buyer_session_secret, { receiverAddr: globals.tester2PublicKey })

    buyer_to_seller.authenticate()

    var seller_to_buyer_tx_id
    Session.all(tester2PrivateKey.publicKey, network, function (err, sessions) {
      if (sessions.length > 1) {
        seller_to_buyer = sessions[0].txid
      }
    })

    //  seller_to_buyer.authenticate()
    var seller_to_buyer
    Session.one(tester2PrivateKey, network, seller_to_buyer_tx_id,
      function (err, session) { seller_to_buyer = session })

    seller_to_buyer.authenticate()

    // TODO: I think this should likely be a simple Session.message(messageStr) call
    var message = new ChatMessage({ contents: 'Hello Buyer' })
    var symmKey = seller_to_buyer.genSymmKey()
    message.encrypt(symmKey)
    session.sendMessage(message)

    var message = new ChatMessage({ contents: 'Hello Seller' })
    var symmKey = buyer_to_seller.genSymmKey()
    message.encrypt(symmKey)
    session.sendMessage(message)

    assert.deepEqual(seller_to_buyer.messages, ['Hello Seller', 'Hello Buyer'])
    assert.deepEqual(buyer_to_seller.messages, ['Hello Seller', 'Hello Buyer'])
  })
})
