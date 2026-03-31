// // Run this from your backend folder:
// // node diagnostic.js

// const authController  = require('./controllers/authController');
// const videoController = require('./controllers/videoController');
// const adminController = require('./controllers/adminController');

// console.log('=== authController ===');
// console.log(Object.keys(authController));

// console.log('\n=== videoController ===');
// console.log(Object.keys(videoController));

// console.log('\n=== adminController ===');
// console.log(Object.keys(adminController));

// // Check for undefined values
// const check = (name, obj) => {
//   Object.entries(obj).forEach(([key, val]) => {
//     if (typeof val !== 'function') {
//       console.error(`❌  ${name}.${key} is NOT a function — got: ${typeof val}`);
//     }
//   });
// };

// check('authController',  authController);
// check('videoController', videoController);
// check('adminController', adminController);

// console.log('\nDone — any ❌ above is your broken handler.');

// diagnostic2.js — copy to backend folder and run: node diagnostic2.js

const { protect, authorize } = require('./middleware/auth');

console.log('=== middleware/auth ===');
console.log('protect:', typeof protect);
console.log('authorize:', typeof authorize);

if (typeof protect !== 'function') console.error('❌ protect is not a function');
if (typeof authorize !== 'function') console.error('❌ authorize is not a function');

// Test authorize returns a function
try {
  const result = authorize('admin');
  console.log('authorize("admin") returns:', typeof result);
  if (typeof result !== 'function') console.error('❌ authorize() does not return a function');
} catch(e) {
  console.error('❌ authorize() threw:', e.message);
}

// Check rate limiters
try {
  const rateLimit = require('express-rate-limit');
  const limiter = rateLimit({ windowMs: 1000, max: 10 });
  console.log('\nrateLimit returns:', typeof limiter);
  if (typeof limiter !== 'function') console.error('❌ rateLimit does not return a function');
} catch(e) {
  console.error('❌ rateLimit error:', e.message);
}

console.log('\nDone.');