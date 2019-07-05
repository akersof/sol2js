const {compile} = require('../src/sol2js');
(async () => {
    try {
       const obj = await compile('./test2.sol', "./output");
       console.log(obj);
    } catch (e) {
        console.log("exit badly");
    }
})();

//const chalk = require('chalk');
//const path = require('path');

//console.log(path.dirname("./"));