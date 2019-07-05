const path = require('path');
const fs = require('fs-extra');
const {promisify} = require('util');
const childProcess = require('child_process');
const exec = promisify(childProcess.execFile);
const commandExists = require('command-exists');
const ethers = require('ethers');
const log = require('./log');
const utils = require('./utils');
const {SOLC_BIN, DEFAULT_JSON_FILENAME} = require('./constants');

//Check if solc compiler is installed
const isSolcInstalled = async () => {
    try {
        await commandExists(SOLC_BIN);
        return true;
    }catch(e) {
        throw new Error(
            log.errorMsg("solc solidity compiler is not installed." +
                " Visit https://solidity.readthedocs.io/en/latest/installing-solidity.html." +
                " Don't install the npm/Node.js package, but Docker or binary package")
        );
    }
};


// Compile the smart contract fileName to json, rename it, and return a javascript object with all contracts with
// their corresponding abi and bytes of the solidity file.
// fileName and outDir should be absolute paths
const _compile2json = async (fileName, outDir) => {
    const args = [
        '--combined-json',
        'abi,bin',
        fileName,
        '--overwrite',
        '-o',
        outDir
    ];
    try {
        await fs.ensureDir(outDir);
        let {error, stdout, stderr} = await exec(SOLC_BIN, args);
        if(error && error.length > 0) log.error(error);
        if(stdout && stdout.length > 0) log.info(stdout);
        if(stderr && stderr.length > 0) log.warning(stderr);
        const obj = (await fs.readJson(path.join(outDir, DEFAULT_JSON_FILENAME))).contracts;
        //need to perform again a JSON.parse on each abi of each contracts in the solidity file to get a real js obj
        const contracts = {};
        Object.keys(obj)
        //TODO: create a filter function
            .filter((elem) => {
                if (path.basename(elem.split(':')[0]) === "Deployable.sol" || elem.split(':')[1] === "Deployable") return false;
                const abi = JSON.parse(obj[elem].abi);
                for (let i = 0; i < abi.length; ++i) {
                    if (abi[i].name === "deployable") return true;
                }
                return false;
            })
            .forEach((key, index) => {
                const contract = key.split(":").pop();
                const abi = JSON.parse(obj[key].abi);
                const bytes = obj[key].bin;
                contracts[contract] = {"abi": abi, "bytes": bytes};
            });
        //rename combined.json
        const outFileName = path.join(outDir, path.basename(fileName, '.sol') + '.json');
        await fs.rename(path.join(outDir, DEFAULT_JSON_FILENAME), outFileName);
        log.success(`compilation of ${fileName} to ${outFileName} succeed`);
        return contracts;
    } catch(e) {
        log.error(e.message);
        log.error(e.stack);
        throw e;
    }
};

// Transpile the javascript object returned from _compile2json to a javascript file
const _compile2js = async (absoluteJsPath, contracts) => {
    let classContent = "";
    let hooksContent = "import React, {useContext, useReducer, useEffect} from 'react';\n" +
        "import {MetaMaskContext, DappContext} from \"../../context\";\n" +
        "const contractReducer = (state, action) => {\n" +
        "    switch(action.type) {\n" +
        "        case \"INIT\":\n" +
        "            return {...state, status: \"init\"};\n" +
        "        case 'LOADING':\n" +
        "            return {...state, status: \"loading\"};\n" +
        "        case 'ERROR':\n" +
        "            return {...state, status: \"error\"};\n" +
        "        case 'SUCCESS':\n" +
        "            return {...state, status: \"success\", result: action.result};\n" +
        "        default:\n" +
        "            return {...state, status: \"error\"};\n" +
        "    }\n" +
        "};\n\n";
    const keys = Object.keys(contracts);
    for (const key of keys) {
        classContent += `
class ${key.charAt(0).toUpperCase() + key.slice(1)} {
    constructor() {
        this.provider = new ethers.providers.Web3Provider(window.ethereum);
        this.contract = new ethers.Contract(contracts.${key}.address, contracts.${key}.abi, this.provider);
        this.signer = this.contract.connect(this.provider.getSigner(window.ethereum.address));
        this.abi = contracts.${key}.abi;
        this.bytes = contracts.${key}.bin;
        this.address = contracts.${key}.address;
        this.name = "${key}";
    }
    ${abi2Method(contracts[key].abi)}
}
`;
        hooksContent += abi2hook(contracts[key].abi, key);
        //let moduleExports = `modules.exports{${...keys}}`;
        const jsContent = `const ethers = require('ethers');\nconst contracts = ${JSON.stringify(contracts, null, 2)};\n`;
        await fs.writeFile(absoluteJsPath, jsContent + classContent + generateExports(contracts));
        await fs.ensureDir(path.join(path.dirname(absoluteJsPath), 'hooks/'));
        await fs.writeFile(path.join(path.dirname(absoluteJsPath), 'hooks/', path.basename(absoluteJsPath)), hooksContent + generateHooksExports(contracts[key].abi));
        //const jsonPath = path.join(absoluteOutDir, JSON_FILENAME);
        //const files = await fs.readdir(absoluteOutDir);
        // console.log(files);
        //const combined = await fs.readJson(jsonPath);
        //console.log(combined);
        //const combined = require(jsonPath);
        //console.log(combined);
        //await fs.writeFile(path.basename(jsonPath).slice(0, -4) + 'js', combined)//.replace(/\\"/g, '"'));
    }
}

const abi2Method = (abiList) => {
    let method = '';
    for(const func of abiList) {
        if(func.type !== 'function') continue;
        const args = func.inputs.map((elem) => `${elem.type}_${elem.name}`);
        func.payable ? args.push('overrides') : '';
        method += `
    async ${func.name}(${args}) {
        return await this.signer.${func.name}(${args});
    }
`;
    }
    return method;
};

const abi2hook = (abiList, key) => {
    let hook = '';
    for(const func of abiList) {
        if(func.type !== 'function') continue;
        const args = func.inputs.map((elem) => `${elem.type}_${elem.name}`);
        func.payable ? args.push('overrides') : '';
        hook += `
const ${func.name} = (${args}) => {
    const dappContext = useContext(DappContext);
    const metaMaskContext = useContext(MetaMaskContext);
    const [state, dispatch] = useReducer(contractReducer, {status: "loading"});
    useEffect(() => {
        if(dappContext.ready)
            (async () => {
                let result = await dappContext.${key}.${func.name}(${args});
                dispatch({type:"SUCCESS", result: result});
            })();}, [metaMaskContext.address, metaMaskContext.network, dappContext.ready]); //TODO: redundant to add address and network ?
    return [state];
}
`;
    }
    return hook;
};

const generateExports = (contracts) => {
    let exportsCode = "";
    exportsCode += "\nexport let ";
    const keys = Object.keys(contracts);
    for(const key of keys) {
        exportsCode += `${key} = new ${key.charAt(0).toUpperCase() + key.slice(1)}(), `
    }
    exportsCode = exportsCode.slice(0, -2);
    exportsCode += ";\n";
    return exportsCode;
};

const generateHooksExports = (contracts) => {
    let exportCode = "module.exports = { ";
    //const keys = Object.keys(contracts);
    for(const key of contracts) {
        exportCode += `${key.name}, `;
    }
    exportCode = exportCode.slice(0, -2);
    exportCode += "};";
    return exportCode;
}

exports.compile = async (fileName, outDir) => {
    try {
        await isSolcInstalled();
        outDir = (!outDir || outDir.length === 0) ? './' : outDir;
        const absoluteOutDir = path.resolve(outDir);
        const absoluteSolPath = path.resolve(fileName);
        let contracts =  await _compile2json(absoluteSolPath, absoluteOutDir);
        contracts = await _deploy(contracts);
        const absoluteJsPath = path.join(absoluteOutDir, path.basename(fileName, '.sol') + '.js');
        await _compile2js(absoluteJsPath, contracts);
    }catch(e) {
        log.error('Compilation failed');
        log.error(e.message);
        throw e;
    }
};

const _deploy = async (contracts) => {
    const provider = new ethers.providers.JsonRpcProvider("http://localhost:7545");
    const signer = provider.getSigner(0);
    for(const key of Object.keys(contracts)) {
        let factory = new ethers.ContractFactory(contracts[key].abi, contracts[key].bytes, signer);
        let contract = await factory.deploy();
        contracts[key].address = contract.address;
        log.info(`Deploying contract ${key} at ${contract.address}`);
        await contract.deployed();
        log.success(`Contract ${key} deployed at ${contract.address}`);
    }
    return contracts;
};

