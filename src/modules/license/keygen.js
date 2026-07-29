'use strict';

const crypto = require('crypto');

function generateLicenseKey() {
  const bytes = crypto.randomBytes(10).toString('hex').toUpperCase(); // 20 hex chars
  return bytes.match(/.{1,4}/g).join('-'); // XXXX-XXXX-XXXX-XXXX-XXXX
}

module.exports = { generateLicenseKey };
