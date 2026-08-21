'use strict';

const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:               process.env.DB_HOST,
      port:               Number(process.env.DB_PORT) || 3306,
      user:               process.env.DB_USER,
      password:           process.env.DB_PASSWORD,
      database:           process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit:    10,
      namedPlaceholders:  true,
    });
  }
  return pool;
}

async function query(sql, params) {
  const [result] = await getPool().execute(sql, params);
  return result;
}

// Connects, then lets every discovered module create its own tables
// (CREATE TABLE IF NOT EXISTS, safe to run every start). Called once at
// startup from index.js.
async function init() {
  getPool();
  const moduleLoader = require('./moduleLoader');
  await moduleLoader.initModuleSchemas(getPool());
}

module.exports = { getPool, query, init };
