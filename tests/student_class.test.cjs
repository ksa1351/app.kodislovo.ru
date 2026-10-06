const assert=require('assert/strict');const {normalize,valid}=require('../assets/js/student-class.js');
for(const value of ['7','7б','7 Б','7 «б»','7 класс'])assert.equal(normalize(value),'7Б');
for(const value of ['7А','7Г','5А','5Б','11А'])assert.equal(normalize(value),value);
for(const value of ['5','7b','12Б','Б7',''])assert.equal(valid(value),false);
for(const value of ['7','7б','9 в','11 а'])assert.equal(valid(value),true);
console.log('Student class normalization and format validation passed');
