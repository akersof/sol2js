const chalk = require('chalk');

const infoMsg = (msg) => chalk.blue(msg);
const info = (msg) => {
    console.log(infoMsg(msg));
};

const successMsg = (msg) => chalk.green(msg);
const success = (msg) => {
    console.log(successMsg(msg));
};

const warningMsg = (msg) => chalk.keyword('orange')(msg);
const warning = (msg) => {
    console.log(warningMsg(msg));
};

const errorMsg = (msg) => chalk.red(msg);
const error = (msg) => {
    console.log(errorMsg(msg));
};

module.exports = {
  success, successMsg,
  info, infoMsg,
  warning, warningMsg,
  error, errorMsg
};