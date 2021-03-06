var inherits = require('inherits')
var extend = require('shallow-extend')
var bitcore = require('bitcore-lib')
var limiter = require('limiter')

var webExplorer = require('./web_explorer')

var RateLimiter = limiter.RateLimiter
var $ = bitcore.util.preconditions
var Transaction = bitcore.Transaction

var ConnectionRefusedError = webExplorer.ConnectionRefusedError
var UnsupportedFeatureError = webExplorer.UnsupportedFeatureError
var WebExplorer = webExplorer.WebExplorer


function SoChain (options, cb) {
  this.__defineGetter__('baseUrl', function () { return 'https://chain.so/' })
  this.__defineGetter__('_chainNet', function () { 
    return (this.isMutable) ? 'BTCTEST' : 'BTC'
  })

  var Super = this.constructor.super_
  Super.call(this, options, cb)

  var limiter = new RateLimiter(1, options.rateLimit  || 250)

  this._rateLimitReq = function(url, cb) {
    limiter.removeTokens(1, function(err, remainingRequests) {
      if (err) cb(err)
      this._req(url, cb)
    }.bind(this))
  }
}

inherits(SoChain, WebExplorer)
extend(SoChain, WebExplorer)

function loadTx(txFromApi, filter, cb) {
  // This is a hacky acceleration hook itemtype scanning, but if we're looking
  // for created items, we only proceed if the recipient starts with 1DZ
  if ((filter.type == 'ITCRTE') && ((!txFromApi.outputs) || 
    (txFromApi.outputs.length == 0) || 
    (typeof txFromApi.outputs[0].address !== 'string') || 
    (!txFromApi.outputs[0].address.match(/^1DZ/)))) { return cb() }

  this.txById(txFromApi.txid, cb)
}

SoChain.prototype.txById = function (txid, cb) {
  $.checkArgument(txid, 'Transaction id is a required parameter')

  this._rateLimitReq(['api/v2/tx/', this._chainNet, '/', txid], function(err, data) {
    if (err) return cb(err)

    var jsonData = JSON.parse(data)

    if (jsonData.status !== 'success') return cb(new MalformedResponseError())

    var attrs = this._hexToAttrs(jsonData.data.tx_hex)

    if (!attrs) return cb() // Not an err, just an unparseable record

    cb(null, extend({txid: txid, blockHeight: jsonData.data.block_no}, attrs))
  }.bind(this))
}

SoChain.prototype.messagesByAddr = function (addr, options, cb) {
  $.checkArgument(addr, 'addr is a required parameter')

  var ret = []
  this._rateLimitReq(['api/v2/address/', this._chainNet, '/', addr], function(err, data) {
    if (err) return cb(err)
  
    var jsonData = JSON.parse(data)

    if (jsonData.status !== 'success') return cb(new MalformedResponseError())

    this._filterTxs(jsonData.data.txs, loadTx.bind(this), options, cb)
  }.bind(this))
}

SoChain.prototype.messagesInBlock = function (height, options, cb) {
  $.checkArgument(height, 'height is a required parameter')

  this._rateLimitReq(['api/v2/block/', this._chainNet, '/', height], function(err, data) {
    if (err) return cb(err)

    jsonData = JSON.parse(data) 

    if (jsonData.status !== 'success') return cb(new MalformedResponseError())

    this._filterTxs(jsonData.data.txs,
      function (txFromApi, filter, next) {
        loadTx.apply(this, [txFromApi, filter, function(err, tx) {
          next(null, (tx) ? extend(tx, {blockHeight: height}) : null)
        }])
      }.bind(this), options, cb)
  }.bind(this))
}

SoChain.prototype.save = function (tx, privateKey, cb) {
  // TODO
}

module.exports = {
  SoChain: SoChain
}
