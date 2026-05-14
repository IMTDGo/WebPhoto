'use strict';
/**
 * 新增本機測試帳號到 dev-accounts.json
 * 用法: node add-dev-account.js <帳號> <密碼>
 * 範例: .\node\node.exe add-dev-account.js z1jaytest W1029384756
 */
const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');

const [,, username, password] = process.argv;
if (!username || !password) {
  console.log('用法: node add-dev-account.js <帳號> <密碼>');
  process.exit(1);
}

const file     = path.join(__dirname, 'dev-accounts.json');
const accounts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

bcrypt.hash(password, 12).then(hash => {
  accounts[username] = { password: hash };
  fs.writeFileSync(file, JSON.stringify(accounts, null, 2));
  console.log(`✔ 已新增帳號 "${username}" 到 dev-accounts.json`);
  console.log('  重新啟動 server 後即可使用此帳號登入');
});
