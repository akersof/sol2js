const commandExists = require('command-exists');
const path = require('path');
const fs = require('fs-extra');
const {promisify} = require('util');
const childProcess = require('child_process');
const exec = promisify(childProcess.execFile);
const log = require('./log');
const {generateClass, generateMethod} = require('./src_gen');


// Output file name of the solc --combined-json
const JSON_FILENAME = "combined.json";
const solc = "solc";

const isSolcInstalled = async () => {
    try {
        await commandExists(solc);
    }catch(e) {

        throw new Error("solc solidity compiler is not installed. Visit https://solidity.readthedocs.io/en/latest/installing-solidity.html. Don't install the npm/Node.js package, but Docker or binary package")
    }
    return true;
};

const _compile2json = async (fileName, absoluteOutDir) => {
    const args = [
        '--combined-json',
        'abi,bin',
        fileName,
        '--overwrite',
        '-o',
        absoluteOutDir
    ];
    try {
        let {error, stdout, stderr} = await exec(solc, args);
        if(error && error.length > 0) log.error(error);
        if(stdout && stdout.length > 0) log.info(stdout);
        if(stderr && stderr.length > 0) log.warning(stderr);
        log.success(`compilation of ${fileName} succeed`);
    }catch(e) {
        log.error(e.stderr);
        throw new Error(e.stderr);
    }

};

exports.compile = async (fileName, outDir) => {
    outDir = (!outDir || outDir.length === 0) ? './' : outDir;
    const absoluteOutDir = outDir;//path.join(process.cwd(), outDir);
    await _compile2json(fileName, absoluteOutDir);
    const jsonBaseName = path.basename(fileName).slice(0, -4) + '.json';
    const jsBaseName = path.basename(fileName).slice(0, -4) + '.js';

    //rename json file
    await fs.rename(path.join(absoluteOutDir, JSON_FILENAME), path.join(absoluteOutDir, jsonBaseName));
    let obj = (await fs.readJson(path.join(absoluteOutDir, jsonBaseName))).contracts;
    const contracts = {};
    Object.keys(obj)
        //TODO: create a filter function
        .filter((elem) => {
            if (path.basename(elem.split(':')[0]) === "Deployable.sol" || elem.split(':')[1] === "Deployable") return false;
            const abi = JSON.parse(obj[elem].abi);
            console.log(abi);
            for(let i = 0; i < abi.length; ++i) {
                if(abi[i].name === "deployable") return true;
            }
            return false;
        } )
        .forEach((key, index) => {
        const clef = key.split(":").pop();
        const abi = JSON.parse(obj[key].abi);
        const bin = obj[key].bin;
        contracts[clef] = {"abi": abi, "bin": bin};
    });

    let classContent = "";
    const keys = Object.keys(contracts);
    for(const key of keys) {
        classContent += `
class ${key} {
    constructor(contract) {
        this.contract = contract;
    }
    ${abi2Method(contracts[key].abi)}
}
`;
    }
    //let moduleExports = `modules.exports{${...keys}}`;
    const jsContent = `const contracts = ${JSON.stringify(contracts, null, 2)};\n`;
    await fs.writeFile(path.join(absoluteOutDir, jsBaseName), jsContent + classContent);

    //const jsonPath = path.join(absoluteOutDir, JSON_FILENAME);
    //const files = await fs.readdir(absoluteOutDir);
   // console.log(files);
    //const combined = await fs.readJson(jsonPath);
    //console.log(combined);
    //const combined = require(jsonPath);
    //console.log(combined);
    //await fs.writeFile(path.basename(jsonPath).slice(0, -4) + 'js', combined)//.replace(/\\"/g, '"'));
};

const abi2Method = (abiList) => {
    let method = '';
    for(const func of abiList) {
        if(func.type !== 'function') continue;
        const args = func.inputs.map((elem) => `${elem.type}_${elem.name}`);
        func.payable ? args.push('overrides') : '';
        method += `
    async ${func.name}(${args}) {
        return await this.contract.${func.name}(${args});
    }
`;
    }
    return method;
};