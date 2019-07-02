const commandExists = require('command-exists');
const path = require('path');
const fs = require('fs-extra');
const {promisify} = require('util');
const childProcess = require('child_process');
const exec = promisify(childProcess.execFile);
const log = require('./log');
const {generateClass, generateMethod} = require('./src_gen');
const ethers = require('ethers');


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
            for (let i = 0; i < abi.length; ++i) {
                if (abi[i].name === "deployable") return true;
            }
            return false;
        })
        .forEach((key, index) => {
            const clef = key.split(":").pop();
            const abi = JSON.parse(obj[key].abi);
            const bin = obj[key].bin;
            contracts[clef] = {"abi": abi, "bin": bin};
        });

    //deploy contract here
    var provider = new ethers.providers.JsonRpcProvider("http://localhost:7545");
    const signer = provider.getSigner(0);
    for (const elem of Object.keys(contracts)) {
        let factory = new ethers.ContractFactory(contracts[elem].abi, contracts[elem].bin, signer);
        let contract = await factory.deploy();
        contracts[elem].address = contract.address;
        console.log(`◐ Contrat ${elem} en deploiement:`, contract.address);
        await contract.deployed();
        console.log("⏺ Contrat déployé");
    }


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
        await fs.writeFile(path.join(absoluteOutDir, jsBaseName), jsContent + classContent + generateExports(contracts));
        await fs.ensureDir(path.join(absoluteOutDir, 'hooks'));
        await fs.writeFile(path.join(absoluteOutDir, 'hooks/', jsBaseName ), hooksContent + generateHooksExports(contracts[key].abi));
        //const jsonPath = path.join(absoluteOutDir, JSON_FILENAME);
        //const files = await fs.readdir(absoluteOutDir);
        // console.log(files);
        //const combined = await fs.readJson(jsonPath);
        //console.log(combined);
        //const combined = require(jsonPath);
        //console.log(combined);
        //await fs.writeFile(path.basename(jsonPath).slice(0, -4) + 'js', combined)//.replace(/\\"/g, '"'));
    }
};

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
