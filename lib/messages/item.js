var async = require('async')
var bitcore = require('bitcore-lib')
var extend = require('shallow-extend')
var inherits = require('inherits')
var message = require('./message')
var bigdecimal = require('bigdecimal')

var BigDecimal = bigdecimal.BigDecimal
var MessageBase = message.MessageBase
var Base58 = bitcore.encoding.Base58
var Hash = bitcore.crypto.Hash

var EARTH_RADIUS_IN_METERS = 6371000
var HASH_160_PARTS = /^(?:mfZ|1DZ)([1-9X]{9})([1-9X]{9})([1-9X]{6}).+/

function pad (n, width, z) {
  z = z || '0'
  n = n + ''
  return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n
}

function isNullOrUndefined (val) {
  return (val === null) || (typeof val === 'undefined')
}

var Item = function Item (connection, attrs) {
  var Super = this.constructor.super_
  Super.call(this, connection, attrs)

  this.__defineGetter__('latitude', function () {
    return (!isNullOrUndefined(attrs.latitude)) ? attrs.latitude
      : this._integerToLatLon(this._addressParts(attrs.receiverAddr, 0))
  })

  this.__defineGetter__('longitude', function () {
    return (!isNullOrUndefined(attrs.longitude)) ? attrs.longitude
    : this._integerToLatLon(this._addressParts(attrs.receiverAddr, 1), 180)
  })

  this.__defineGetter__('radius', function () {
    return (!isNullOrUndefined(attrs.radius)) ? attrs.radius
      : this._addressParts(attrs.receiverAddr, 2)
  })

  /*
   * This is an easy guide to what we're doing here:
   * http://www.reddit.com/r/Bitcoin/comments/2ss3en/calculating_checksum_for_bitcoin_address/
   *
   * NOTE: There was a digit off in the reference spec, this radius is a six
   *       digit number, not an eight digit number.
   */
  this.__defineGetter__('receiverAddr', function () {
    if (attrs.receiverAddr) {
      return attrs.receiverAddr
    } else if (this.createTxid) {
      return this.senderAddr
    } else if ([this.latitude, this.longitude, this.radius].every(
      function (el) { return !isNullOrUndefined(el) })) {
      var receiverAddrBase = [(this.connection.isTesting) ? 'mfZ' : '1DZ',
        pad(this._latlonToInteger(this.latitude), 9),
        pad(this._latlonToInteger(this.longitude, 180), 9),
        pad(Math.abs(this.radius), 6)
       ].join('').replace(/0/g, 'X') + 'XXXXXXX'

      /* The x's pad the checksum component for us to ensure the base conversion
       * produces the correct output. Similarly, we ignore them after the decode:
       */
      var addr = Base58.decode(receiverAddrBase).slice(0, 21)
      var checksum = Hash.sha256(Hash.sha256(addr)).slice(0, 4)

      return Base58.encode(Buffer.concat([addr, checksum]))
    }

    return undefined
  })

  this.__defineGetter__('messageType', function () {
    return (attrs.createTxid) ? 'ITUPDT' : 'ITCRTE'
  })
}

inherits(Item, MessageBase)
extend(Item, MessageBase)

var requiredIfItemCreate = function (cb) {
  if (((this.value === null) || (typeof this.value === 'undefined')) &&
    (this.source.messageType === 'ITCRTE')) {
    this.raise('%s is required in a newly created item', this.field)
  }
  cb()
}

var invalidIfItemCreate = function (cb) {
  if (((this.value !== null) && (typeof this.value !== 'undefined')) &&
    (this.source.messageType === 'ITCRTE')) {
    this.raise('%s cannot be specified in an item create', this.field)
  }
  cb()
}

extend(Item.prototype, {
  type: 'ITCRTE',
  attrString: {d: 'description', c: 'priceCurrency', t: 'createTxid'},
  attrInt: {p: 'priceInUnits', e: 'expirationIn'},
  schemaFields: {
    txid: {type: 'string'},
    tip: {type: 'integer', min: 0},
    messageType: {type: 'string', required: true, pattern: /^IT(?:CRTE|UPDT)$/},
    receiverAddr: [
      {type: 'string', required: true},
      function (cb) {
        if (this.source.createTxid && this.source.senderAddr && this.value &&
          (this.source.senderAddr !== this.value)) {
          this.raise('%s must match senderAddr', this.field)
        }
        cb()
      }
    ],
    createTxid: [{type: 'string'}, invalidIfItemCreate],
    latitude: [{type: 'number', min: -90, max: 90}, requiredIfItemCreate],
    longitude: [{type: 'number', min: -180, max: 180}, requiredIfItemCreate],
    radius: [{type: 'integer', min: 0, max: 999999}, requiredIfItemCreate],
    priceCurrency: [{type: 'string'},
      function (cb) {
        if ((this.source.messageType === 'ITCRTE') && this.source.priceInUnits &&
          ((this.value === null) || (typeof this.value === 'undefined'))) {
          this.raise('%s is required if priceInUnits is provided', this.field)
        }
        cb()
      }],
    description: {type: 'string'},
    priceInUnits: {type: 'integer', min: 0},
    expirationIn: {type: 'integer', min: 0}
  }})

Item.prototype._isValidMessageType = function (type) {
  return ((type === 'ITCRTE') || (type === 'ITUPDT'))
}

Item.prototype._addressParts = function (addr, part) {
  var parts = HASH_160_PARTS.exec(addr)
  return (parts && parts.length > 0)
    ? parseInt(parts[part + 1].replace(/X/g, '0'), 10) : undefined
}

Item.prototype._integerToLatLon = function (latlon, unsignedOffset) {
  if (!unsignedOffset) unsignedOffset = 90

  if (isNullOrUndefined(latlon)) return undefined

  var bigLatlon = new BigDecimal(latlon)
  var bigMillion = new BigDecimal('1000000')
  var bigOffest = new BigDecimal(String(unsignedOffset))

  return parseFloat(bigLatlon.divide(bigMillion).subtract(bigOffest).toString())
}

Item.prototype._latlonToInteger = function (latlon, unsignedOffset) {
  if (!unsignedOffset) unsignedOffset = 90

  return Math.abs(Math.floor((latlon + unsignedOffset) * 1000000))
}

// haversine formula, pulled from :
// http://www.movable-type.co.uk/scripts/latlong.html
Item.distanceBetween = function (lat1, lon1, lat2, lon2) {
  var toRadians = function (n) { return n * Math.PI / 180 }

  var deltaPhi = toRadians(lat2 - lat1)
  var deltaLambda = toRadians(lon2 - lon1)

  var a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_IN_METERS * c
}

/* Returns all *Items created* since (and including) the provided block
 * These are items and not listings, so as to query faster.
 * Items are returned in the order of newest to oldest
 */
Item.findCreatesSinceBlock = function (connection, startingAt, blockDepth, cb) {
  var scanBlocks = Array.apply(null, {length: blockDepth + 1}).map(
    Number.call, function (i) { return startingAt - i })

  async.mapSeries(scanBlocks,
    function (i, next) { connection.messagesInBlock(i, {type: 'ITCRTE'}, next) },
    function (err, blocks) {
      if (err) return cb(err)

      // Flatten & Remove empty elemnts:
      cb(null, [].concat.apply([], blocks).filter(function (n) { return !!n }))
    })
}

Item.findInRadius = function (connection, startingAt, blockDepth, lat, lon, inMeters, cb) {
  Item.findCreatesSinceBlock(connection, startingAt, blockDepth, function (err, items) {
    if (err) return cb(err)

    cb(err, items.filter(function (item) {
      return (Item.distanceBetween(item.latitude, item.longitude, lat, lon) <= inMeters)
    }))
  })
}

module.exports = {
  Item: Item
}
