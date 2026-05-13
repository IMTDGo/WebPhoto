/**
 * seed.js — 一次性腳本，在 MongoDB 建立初始帳號
 *
 * 用法:
 *   node seed.js
 *   (或 npm run seed)
 *
 * 需要先設定 .env 中的 MONGODB_URI
 */

'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const SEED_USERNAME = process.env.SEED_USER || '123456';
const SEED_PASSWORD = process.env.SEED_PASS || '123456';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI 未設定，請先建立 .env 檔案');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✔ 已連線到 MongoDB Atlas');

  // 若帳號已存在則更新密碼，否則新增
  const hash = await bcrypt.hash(SEED_PASSWORD, 12);
  await User.findOneAndUpdate(
    { username: SEED_USERNAME },
    { username: SEED_USERNAME, password: hash },
    { upsert: true, new: true }
  );

  console.log(`✔ 帳號 "${SEED_USERNAME}" 已寫入資料庫（密碼已 bcrypt hash）`);
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed 失敗:', err.message);
  process.exit(1);
});
