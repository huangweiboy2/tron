const TronWeb  = require('tronweb');
const express  = require('express');
const sqlite3  = require('sqlite3').verbose();
const ethers   = require('ethers')
const http     = require('http');
const AbiCoder = ethers.utils.AbiCoder;
const app      = express();




const tablename = 'usdt_trc20';
const TronApiKey = '5e40c0ef-5882-42f8-bf4d-287f829cfb58';
const db = new sqlite3.Database('address.db', (err) => {
    if (err) {
        console.error('sqlite3 error: '+ err.message);
        process.exit(-1);
    }
});

db.serialize(() => {
        //创建表
    db.run('CREATE TABLE IF NOT EXISTS ' + tablename + '\
        (address TEXT PRIMARY KEY NOT NULL, \
         privatekey TEXT NOT NULL, \
         publickey TEXT NOT NULL, \
         notifyurl TEXT NOT NULL, \
         collect_address TEXT NOT NULL, \
         extra TEXT,tid TEXT)');
        //对address参数设置索引
    db.run('CREATE INDEX IF NOT EXISTS idx_' + tablename + ' ON ' + tablename + '(address)');
    db.run('UPDATE ' + tablename + ' SET tid=?', ['']);
});

const TestEnvironment = false;
const BoughtEnergyFee = 80; //购买的能量单价多少sun，设置为0时代表没购买能量，是质押的能量
const SwapService_USDT_MIN = 10; //USDT闪兑TRX服务 至少需要这么多U才执行
const SwapService_TRX_MIN = 10; //TRX闪兑USDT服务 至少需要这么多TRX才执行

let USDT_CONTRACT_ADDRESS, USDT_TRX_SWAP_CONTRACT_ADDRESS, ApiUrl, privateKey;

if (TestEnvironment) {
    USDT_CONTRACT_ADDRESS = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
    USDT_TRX_SWAP_CONTRACT_ADDRESS = 'TXfWZVvnrefjrySBPvbs269o6epibdjwRC';
    ApiUrl = 'https://api.nileex.io';
    privateKey = '***';
} else {
    USDT_CONTRACT_ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    USDT_TRX_SWAP_CONTRACT_ADDRESS = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
    ApiUrl = 'https://api.trongrid.io';
    // 手续费钱包、区块链监控对象，烧TRX
    privateKey = '***';
}

const feetron = new TronWeb({
    fullHost: ApiUrl,
    solidityNode: ApiUrl,
    eventServer: ApiUrl,
    privateKey: privateKey
});
if (!TestEnvironment) {
    feetron.setHeader({ "TRON-PRO-API-KEY": TronApiKey });
}
const feeaddress = feetron.address.fromPrivateKey(privateKey);
console.log('手续费钱包已部署', feeaddress);

const sleep = function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function U2T_Amount(usdtamount_sun) {

    if (usdtamount_sun * 1 < feetron.toSun(SwapService_USDT_MIN) * 1) {
        return 0;
    }

    let fee = usdtamount_sun / 100;
    fee = fee.toFixed(0);
    if (fee < feetron.toSun(1) * 1) { //至少收1U手续费
        fee = feetron.toSun(1);
    }

    let amount = usdtamount_sun * 1 - fee * 1;
    amount = amount.toFixed(0);

    try {
        let data = await feetron.transactionBuilder.triggerConstantContract(USDT_TRX_SWAP_CONTRACT_ADDRESS, 'getTokenToTrxInputPrice(uint256)', {}, [{ type: 'uint256', value: amount }]);
        trxamount_sun = feetron.toDecimal("0x" + data.constant_result[0]);
        console.log(feetron.fromSun(trxamount_sun));
        return trxamount_sun;
    } catch (error) {
        return 0;
    }
    return 0;
}

async function SmartContractDecodeParams(types, output, ignoreMethodHash) {

    if (!output || typeof output === 'boolean') {
        ignoreMethodHash = output;
        output = types;
    }

    if (ignoreMethodHash && output.replace(/^0x/, '').length % 64 === 8) {
        output = '0x' + output.replace(/^0x/, '').substring(8);
    }
    
    let abiCoder = new AbiCoder();

    if (output.replace(/^0x/, '').length % 64) {
        //throw new Error('The encoded string is not valid. Its length must be a multiple of 64.');
        return [];
    }

    try {
        return abiCoder.decode(types, output).reduce((obj, arg, index) => {
            if (types[index] == 'address') {
                arg = '41' + arg.substr(2).toLowerCase();
            }
            obj.push(arg);
            return obj;
        }, []);
    }catch(error){
        return [];
    }
}

async function transferTRX(newAddress, amount) {
    amount = feetron.toSun(amount)
    let receipt = '';
    try {
        let transaction = await feetron.transactionBuilder.sendTrx(newAddress.address.base58, amount, feeaddress);
        let transactionId = await feetron.trx.sign(transaction, privateKey);
        receipt = await feetron.trx.sendRawTransaction(transactionId);
    } catch (error) {
        console.log('手续费钱包 TRX 转出出错', error);
        return false;
    }
    return receipt.result;
}

async function transferTRX_(s, _address, newAddress, NetWeightFee) {
    let trxamount = 0;
    try {
        trxamount = await s.trx.getBalance(_address);
    }catch(error){
        trxamount = 0;
    }
    if (trxamount > 0) {
        let restfreenet = 0;
        try {
            let accountdata = await s.trx.getAccountResources(_address);
            restfreenet = accountdata.freeNetLimit - accountdata.freeNetUsed;
        } catch (err) {
            restfreenet = 0;
        }
        if (restfreenet < 400) {
            let NetWeig = 0;
            if (NetWeightFee <= 0) {
                trxamount = trxamount * 1 - s.toSun(0.4) * 1;
            } else {
                try {
                    let pretest = await s.transactionBuilder.sendTrx(feeaddress, trxamount, _address);
                    NetWeig = JSON.stringify(pretest.raw_data).length;
                } catch (error) {
                    NetWeig = 0;
                }
                if (NetWeig > 0) {
                    trxamount = trxamount * 1 - NetWeig * NetWeightFee;
                } else {
                    trxamount = trxamount * 1 - s.toSun(0.4) * 1;
                }
            }
        }
    }
    try {
        if (trxamount > 0) {
            let transaction = await s.transactionBuilder.sendTrx(feeaddress, trxamount, _address);
            let transactionId = await s.trx.sign(transaction, newAddress.privateKey);
            let receipt = await s.trx.sendRawTransaction(transactionId);
            if (receipt.result) {
                console.log('TRX返还成功', _address, '=>', feeaddress, s.fromSun(trxamount));
            } else {
                console.log('TRX返还失败', _address, '=>', feeaddress, s.fromSun(trxamount), receipt);
            }
        }
    } catch (error) {
        console.log('TRX返还出错',error);
    }
}

async function UnlockTransfer(s, _address, newAddress, NetWeightFee) {
    await transferTRX_(s, _address, newAddress, NetWeightFee);
    db.run('UPDATE ' + tablename + ' SET tid=? WHERE address=?', ['', _address], (err) => { });
}

async function CalculateFee(s, to, saddress, usdtamount, call) {

    try {
        let data = await s.transactionBuilder.triggerConstantContract(
            USDT_CONTRACT_ADDRESS,
            'transfer(address,uint256)',
            {},
            [
                { type: 'address', value: to },
                { type: 'uint256', value: usdtamount },
            ], saddress
        );

        let need_energy = data.energy_used * 1;

        let need_net = JSON.stringify(data.transaction.raw_data).length * 1;

        return call(need_energy, need_net);
    } catch (error) {
        return call(0,0);
    }
}

async function GetNowEnergyRest() {
    try {
        let data = await feetron.trx.getAccountResources(feeaddress);
        let a = data.EnergyLimit * 1;
        let b = data.EnergyUsed * 1;
        let c = a * 1 - b * 1;
        if (a <= 0 || b <= 0 || c <= 0) {
            return 0;
        } else {
            return c;
        }
    } catch (error) {
        return 0;
    }
}

async function CalculateSwapFee(s, targetcontract, saddress, usdtamount_sun, call) {

    try {
        let data = await s.transactionBuilder.triggerConstantContract(
            USDT_CONTRACT_ADDRESS,
            'approve(address,uint256)',
            {},
            [
                { type: 'address', value: targetcontract },
                { type: 'uint256', value: usdtamount_sun },
            ], saddress
        );

        let need_energy = data.energy_used * 1;
        if (need_energy <= 0) {
            return call(0,0);
        }
        need_energy = need_energy * 1 + 80000 * 1;

        let need_net = JSON.stringify(data.transaction.raw_data).length * 1;
        need_net = need_net * 1 + 400 * 1;

        return call(need_energy, need_net);
    } catch (error) {
        return call(0,0);
    }
}

async function SwapUSDT2TRX(s, sprivatekey, saddress, usdtamount_sun) {

    try {
        let data = await s.transactionBuilder.triggerSmartContract(
            USDT_CONTRACT_ADDRESS,
            'approve(address,uint256)',
            {},
            [
                { type: 'address', value: USDT_TRX_SWAP_CONTRACT_ADDRESS },
                { type: 'uint256', value: usdtamount_sun },
            ], saddress
        );
        let signedTransaction = await s.trx.sign(data.transaction, sprivatekey);
        let broadcastResult = await s.trx.sendRawTransaction(signedTransaction);
        if (broadcastResult.txid) {
            //data = await s.transactionBuilder.triggerConstantContract(USDT_TRX_SWAP_CONTRACT_ADDRESS, 'tokenToTrxSwapInput(uint256,uint256,uint256)', {}, [
            //    { type: 'uint256', value: usdtamount_sun }, { type: 'uint256', value: usdtamount_sun }, { type: 'uint256', value: Math.floor(Date.now() / 1000) + 3600 }
           // ], saddress);
            //console.log(data);
            data = await s.transactionBuilder.triggerSmartContract(USDT_TRX_SWAP_CONTRACT_ADDRESS, 'tokenToTrxSwapInput(uint256,uint256,uint256)', {}, [
                { type: 'uint256', value: usdtamount_sun }, { type: 'uint256', value: usdtamount_sun }, { type: 'uint256', value: Math.floor(Date.now() / 1000) + 3600 }
            ], saddress);
            signedTransaction = await s.trx.sign(data.transaction, sprivatekey);
            broadcastResult = await s.trx.sendRawTransaction(signedTransaction);
            //let out = await s.trx.getTransaction(broadcastResult.txid);
            return broadcastResult.txid != "";
        }
        return false;
    } catch (error) {
        console.log('USDT2TRX error', error);
        return false;
    }
    return false;
}

async function transferUSDT(newAddress, row, notifyurl, notifyextra) {

    let s = new TronWeb({
        fullHost: ApiUrl,
        solidityNode: ApiUrl,
        eventServer: ApiUrl,
        privateKey: newAddress.privateKey
    });

    if (!TestEnvironment) {
        s.setHeader({ "TRON-PRO-API-KEY": TronApiKey });
    }

    let to = row.collect_address;

    let usdtContract = await s.contract().at(USDT_CONTRACT_ADDRESS);
    let _address = newAddress.address.base58;

    let usdtamount = s.toDecimal(await usdtContract.balanceOf(_address).call());

    let CnFee = await s.trx.getChainParameters();
    let EnergyFee = 0; //能量单价420sun
    let NetWeightFee = 0; //带宽单价1000sun
    CnFee.forEach((key_val, index) => {
        if (key_val.key == 'getEnergyFee') {
            EnergyFee = key_val.value * 1;
        }
        if (key_val.key == 'getTransactionFee') {
            NetWeightFee = key_val.value * 1;
        }
    });

    if (EnergyFee <= 0 || NetWeightFee <= 0) {
        NotifyData(notifyurl, { "code": 101, "msg": "查询能量和带宽单价失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
        await UnlockTransfer(s, _address, newAddress, 0);
        return false;
    }

    let feelimita = 0;
    let need_energya = 0;
    let need_neta = 0;

    let feelimitb = 0;
    let need_energyb = 0;
    let need_netb = 0;

    let feec = 0;
    let need_energyc = 0;
    let need_netc = 0;

    let transferfee_usdt = 0;
    let nowenergy = await GetNowEnergyRest();

    try {
        await CalculateFee(s, feeaddress, _address, usdtamount, (a, b) => {
            need_energya = a;
            need_neta = b;
        });
        if (need_energya <= 0 || need_neta <= 0) {
            NotifyData(notifyurl, { "code": 104, "msg": "计算当前交易所需手续费失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
            await UnlockTransfer(s, _address, newAddress, NetWeightFee);
            return false;
        }
        if (to != feeaddress) {
            await CalculateFee(s, to, _address, usdtamount, (a, b) => {
                need_energyb = a;
                need_netb = b;
            });
            if (need_energyb <= 0 || need_netb <= 0) {
                NotifyData(notifyurl, { "code": 105, "msg": "计算当前交易所需手续费失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
                await UnlockTransfer(s, _address, newAddress, NetWeightFee);
                return false;
            }
        }
        await CalculateSwapFee(feetron, USDT_TRX_SWAP_CONTRACT_ADDRESS, feeaddress, s.toSun(6), (a, b) => {
            need_energyc = a;
            need_netc = b;
        });
        if (need_energyc <= 0 || need_netc <= 0) {
            NotifyData(notifyurl, { "code": 103, "msg": "计算当前交易所需手续费失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
            await UnlockTransfer(s, _address, newAddress, NetWeightFee);
            return false;
        }

        if (nowenergy > (need_energya * 1 + need_energyb * 1 + need_energyc * 1) && BoughtEnergyFee > 0) {
            feelimita = need_energya * BoughtEnergyFee * 1 + need_neta * NetWeightFee * 1;
            feelimitb = need_energyb * BoughtEnergyFee * 1 + need_netb * NetWeightFee * 1;
            feec = need_energyc * BoughtEnergyFee * 1 + need_netc * NetWeightFee * 1;
        } else {
            feelimita = need_energya * EnergyFee * 1 + need_neta * NetWeightFee * 1;
            feelimitb = need_energyb * EnergyFee * 1 + need_netb * NetWeightFee * 1;
            feec = need_energyc * EnergyFee * 1 + need_netc * NetWeightFee * 1;
        }

        feelimita = s.fromSun(feelimita) * 1;
        feelimitb = s.fromSun(feelimitb) * 1;
        feec = s.fromSun(feec) * 1;
        feelimita = feelimita.toFixed(6);
        feelimitb = feelimitb.toFixed(6);
        feec = feec.toFixed(6);

        let nowfee = await feetron.trx.getBalance(feeaddress);
        let nowneedfee = s.toSun(feelimita) * 1 + s.toSun(feelimitb) * 1 + s.toSun(feec) * 1 + 300 * NetWeightFee + s.toSun(0.3) * 1; //从手续费钱包转出TRX是要消耗带宽的、留0.3 TRX是为了保持钱包的可用状态

        if (nowfee < nowneedfee) {
            NotifyData(notifyurl, { "code": 107, "msg": `服务手续费钱包TRX余额不足,余 ${s.fromSun(nowfee)},需 ${s.fromSun(nowneedfee)}`, "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
            await UnlockTransfer(s, _address, newAddress, NetWeightFee);
            return false;
        }
        let tmp = s.toSun(feelimita * 1 + feelimitb * 1 + feec * 1) * 1;
        tmp = tmp.toFixed(0);
        let data = await s.transactionBuilder.triggerConstantContract(USDT_TRX_SWAP_CONTRACT_ADDRESS, 'getTokenToTrxOutputPrice(uint256)', {}, [{ type: 'uint256', value: tmp }]);
        transferfee_usdt = s.fromSun(s.toDecimal("0x" + data.constant_result[0])) * 1;
        if (transferfee_usdt <= 0) {
            NotifyData(notifyurl, { "code": 106, "msg": "计算当前交易所需手续费失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
            await UnlockTransfer(s, _address, newAddress, NetWeightFee);
            return false;
        }

        //USDT闪兑TRX收0.4%的手续费
        transferfee_usdt = transferfee_usdt * 1 + transferfee_usdt * 0.004;
        transferfee_usdt = transferfee_usdt.toFixed(6);

    } catch (error) {
        NotifyData(notifyurl, { "code": 108, "msg": `计算当前交易所需手续费时出现系统错误 ${error}`, "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
        await UnlockTransfer(s, _address, newAddress, NetWeightFee);
        return false;
    }

    if (usdtamount <= s.toSun(transferfee_usdt * 1 + 1) || usdtamount <= 0) {
        NotifyData(notifyurl, { "code": 102, "msg": `地址USDT余额 ${s.fromSun(usdtamount)} 不足以支付手续费消耗 ${transferfee_usdt * 1 + 1},无法触发归集`, "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
        await UnlockTransfer(s, _address, newAddress, NetWeightFee);
        return false;
    }

    let trxamount = s.fromSun(await s.trx.getBalance(_address));
    if (trxamount < feelimita * 1 + feelimitb * 1) {
        let result = await transferTRX(newAddress, feelimita * 1 + feelimitb * 1);
        if (result) {
            console.log(_address, '<= ' + (feelimita * 1 + feelimitb * 1) + ' TRX 手续费转入');

            //每6s查询一次归集账号trx，确认trx已到账，最多等待三分钟
            let texcheck = 0;
            for (let i = 0; i < 30; i++) {
                texcheck = await s.trx.getBalance(_address);
                if (s.fromSun(texcheck) >= feelimita * 1 + feelimitb * 1) {
                    break;
                }
                await sleep(6000)
            }
            if (s.fromSun(texcheck) < feelimita * 1 + feelimitb * 1) {
                NotifyData(notifyurl, { "code": 109, "msg": "等待手续费(TRX)转入待被归集钱包超时(3min)", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
                await UnlockTransfer(s, _address, newAddress, NetWeightFee);
                return false;
            }

        } else {
            NotifyData(notifyurl, { "code": 110, "msg": "手续费(TRX)转入待被归集钱包失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
            await UnlockTransfer(s, _address, newAddress, NetWeightFee);
            return false;
        }
    }

    let feeAddLimit = s.toSun(300) * 1; //待归集账号大于等于这么多U时，额外手续费上调到1%
    let amounta, amountb;
    if (usdtamount >= feeAddLimit) {
        amounta = Math.trunc(usdtamount * 1 / 100) + s.toSun(transferfee_usdt) * 1;
        amountb = usdtamount * 1 - amounta * 1;
    } else {
        amounta = s.toSun(transferfee_usdt * 1 + 1) * 1;
        amountb = usdtamount * 1 - amounta * 1;
    }

    amounta = amounta * 1;
    amountb = amountb * 1;
    amounta = amounta.toFixed(0);
    amountb = amountb.toFixed(0);

    try {
        let transferResult = false;

        if (to != feeaddress) {
            if (amounta > 0 && amountb > 0) {
                let tmpret = await usdtContract.transfer(feeaddress, amounta).send({
                    shouldPollResponse: true,
                    callValue: 0,
                    feeLimit: s.toSun(feelimita),
                    //shouldRetry: true
                });
                if (tmpret) {

                    transferResult = await usdtContract.transfer(to, amountb).send({
                        shouldPollResponse: true,
                        callValue: 0,
                        feeLimit: s.toSun(feelimitb),
                        //shouldRetry: true
                    });

                    if (transferResult) {
                        db.run('DELETE FROM ' + tablename + ' WHERE address=?', [_address], (err) => { });
                        await SwapUSDT2TRX(s, newAddress.privateKey, _address, s.toSun(transferfee_usdt));
                        NotifyData(notifyurl, { "code": 0, "msg": "ok", "notifyType": "归集结果", "from": _address, "to": to, "amount": `${s.fromSun(amountb)}`, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
                    } else {
                        NotifyData(notifyurl, { "code": 111, "msg": "USDT归集失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
                    }

                } else {
                    transferResult = false;
                    NotifyData(notifyurl, { "code": 1111, "msg": "USDT归集失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
                }
            }

        } else {

            if (usdtamount > 0) {
                transferResult = await usdtContract.transfer(to, usdtamount).send({
                    shouldPollResponse: true,
                    callValue: 0,
                    feeLimit: s.toSun(feelimita),
                    //shouldRetry: true
                });

                if (transferResult) {
                    db.run('DELETE FROM ' + tablename + ' WHERE address=?', [_address], (err) => { });
                    await SwapUSDT2TRX(s, newAddress.privateKey, _address, s.toSun(transferfee_usdt));
                    NotifyData(notifyurl, { "code": 0, "msg": "ok", "notifyType": "归集结果", "from": _address, "to": to, "amount": `${s.fromSun(usdtamount)}`, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
                } else {
                    NotifyData(notifyurl, { "code": 111, "msg": "USDT归集失败", "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
                }
            }

        }
        await UnlockTransfer(s, _address, newAddress, NetWeightFee);
        return transferResult;
    } catch (error) {
        console.log(error);
        NotifyData(notifyurl, { "code": 112, "msg": `USDT归集流程出现系统错误 ${error}`, "notifyType": "归集结果", "from": _address, "to": to, "extra": notifyextra, "from_privatekey": newAddress.privateKey });
        await UnlockTransfer(s, _address, newAddress, NetWeightFee);
        return false;
    }
}

// 离线生成新的USDT TRC20地址，并将地址保存在sqlite中
async function generateNewAddress(notifyurl, collect_address, extra,callback) {
    let newAddress = await feetron.createAccount();
    let address = newAddress.address;
    let _privateKey = newAddress.privateKey;
    let publicKey = newAddress.publicKey;

    await db.run(
        'INSERT INTO ' + tablename + '(address, privatekey, publickey, notifyurl, collect_address, extra, tid) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [address.base58, _privateKey, publicKey, notifyurl, collect_address, extra, ''],
        (err) => {
            if (err) {
                let ret = { "code": 2, "msg": "地址记录时出现系统错误"};
                return callback(ret);
            } else {
                //let ret = { "code": 0, "msg": "ok", "address": address.base58, "privatekey": _privateKey };
                let ret = { "code": 0, "msg": "ok", "address": address.base58 };
                return callback(ret);
            }
        }
    );
}

async function CheckBlockAddress(to, callback) {
    db.get('SELECT * FROM ' + tablename + ' WHERE address = ?', [to], (err, row) => {
        if (err) {
            return callback('SQLITE3 ERROR', 'err', '','');
        } else if (row) {
            let newad = {
                privateKey: row.privatekey,
                publicKey: row.publickey,
                address: {
                    base58: row.address,
                    hex: feetron.address.toHex(row.address)
                }
            };

            let tid = row.tid;
            if (tid != '') {
                return callback('已在处理 ' + row.address + ' 归集程序 => ' + to + ' 归集完成需要大约3-4分钟，请等待归集结果通知', '', row.notifyurl, row.extra);
            }

            db.run('UPDATE ' + tablename + ' SET tid=? WHERE address=?', ['has', row.address], (err) => { }); //相当于加锁了

            //异步执行归集
            transferUSDT(newad, row, row.notifyurl, row.extra);

            return callback('', row.collect_address, row.notifyurl, row.extra);
        }
        return callback('未找到地址 ' + to + ' 的记录', 'err', '','');
    });
}

async function IsHasThisAddress(address) {
    db.get('SELECT * FROM ' + tablename + ' WHERE address = ?', [address], (err, row) => {
        if (err) {
            return false;
        } else if (row) {
            return true;
        } else {
            return false;
        }
    });
    return false;
}

async function NotifyData(url, data) {
    console.log(data);
    let urlA = require('url');
    let urlObj = urlA.parse(url);
    let postData = JSON.stringify(data);

    if (urlObj.hostname == '127.0.0.1' || urlObj.hostname == 'localhost') {
        if (!TestEnvironment) {
            return;
        }
    }

    let options = {
        hostname: urlObj.hostname,
        port: urlObj.port || 80,
        path: urlObj.path,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
    let req = http.request(options, (res) => {
        //console.log(`statusCode: ${res.statusCode}`);

        res.on('data', (data) => {
            //console.log(data.toString());
        });
    });
    req.on('error', (error) => {
        //console.error('NotifyFailed',error);
    });
    req.write(postData);
    req.end();
}




let latestBlockNumber = -1;
async function ContractWatch() {
    try {
        let data = await feetron.trx.getCurrentBlock();
        let currentBlockNumber = data.block_header.raw_data.number;
        if (currentBlockNumber < 0 || currentBlockNumber == latestBlockNumber) {
            setTimeout(ContractWatch, 5000);
            return;
        }
        if (latestBlockNumber < 0 || currentBlockNumber < latestBlockNumber) {
            latestBlockNumber = currentBlockNumber - 1;
        }
        let blockData = [];
        if (currentBlockNumber - (latestBlockNumber + 1) > 0) {
            blockData = await feetron.trx.getBlockRange(latestBlockNumber + 1, currentBlockNumber);
        } else {
            blockData = [await feetron.trx.getBlock(currentBlockNumber)];
        }
        blockData.forEach((block) => {
            if (block.transactions) {
                block.transactions.forEach(async (tx) => {
                    let transtype = tx.raw_data.contract[0].type;
                    if (transtype == 'TransferContract') {
                        if (tx.ret[0].contractRet == 'SUCCESS') {
                            /*
                            let data = tx.raw_data.contract[0].parameter.value;
                            let amount = data.amount; //如果是归集操作退回的TRX，数量不会太大
                            let owner_address = feetron.address.fromHex(data.owner_address);
                            let to_address = feetron.address.fromHex(data.to_address);
                            //闪兑业务转账
                            if (to_address == feeaddress && amount >= feetron.toSun(SwapService_TRX_MIN)) {

                            }
                            */
                        }
                    } else if (transtype == 'TriggerSmartContract') {
                        if (tx.ret[0].contractRet == 'SUCCESS') {
                            let owner_address = feetron.address.fromHex(tx.raw_data.contract[0].parameter.value.owner_address);
                            let contract_address = feetron.address.fromHex(tx.raw_data.contract[0].parameter.value.contract_address);
                           if (contract_address == USDT_CONTRACT_ADDRESS) { //合约必须一致
                               let methodData = '0x' + tx.raw_data.contract[0].parameter.value.data;
                               if (methodData.slice(0, 10) === '0xa9059cbb') { //判断智能合约的函数是否为transfer()
                                   let decodedData = await SmartContractDecodeParams(['bytes32', 'uint256'], methodData, true);
                                   /*
                                   bool：布尔值，占用 1 个字节，值为 0 或 1。
                                   int8 到 int256：有符号整数，占用 1 到 32 个字节，其中 int8 占用 1 个字节，int16 占用 2 个字节，以此类推，int256 占用 32 个字节。
                                   uint8 到 uint256：无符号整数，占用 1 到 32 个字节，其中 uint8 占用 1 个字节，uint16 占用 2 个字节，以此类推，uint256 占用 32 个字节。
                                   bytes1 到 bytes32：动态字节数组，占用 1 到 32 个字节，其中 bytes1 占用 1 个字节，bytes2 占用 2 个字节，以此类推，bytes32 占用 32 个字节。
                                   address
                                   unit256
                                    */
                                    if (decodedData.length >= 2) {
                                        let to_address = decodedData[0].substring(2);
                                        to_address = to_address.replace(/^0+/, "");
                                        if (to_address.substr(0, 2) != '41') {
                                            to_address = '41' + to_address;
                                        }
                                        to_address = feetron.address.fromHex(to_address);
                                        let amount = decodedData[1].toString(); //sun类型
                                        if (to_address == feeaddress) {
                                            /*
                                            if (await IsHasThisAddress(owner_address) == false) {
                                                //闪兑业务转账
                                                if (amount >= feetron.toSun(SwapService_USDT_MIN)) {

                                                }
                                            }
                                            */
                                        }
                                        CheckBlockAddress(to_address, (error, hascheck, notifyurl, notifyextra) => {
                                            if (hascheck != 'err') {
                                                NotifyData(notifyurl, { "code": 0, "msg": "ok", "notifyType": "转账通知", "from": owner_address, "to": to_address, "amount": feetron.fromSun(amount), "extra": notifyextra });
                                            }
                                        });
                                    }
                                }
                           }
                        }
                    } else {
                        //console.log(tx, tx.raw_data.contract); 其他类型的事件
                    }
                });
            }
        });
        latestBlockNumber = currentBlockNumber;
    } catch (error) {
        console.log('区块链监听出错', error);
    }
    setTimeout(ContractWatch, 5000);
}
//启动区块链监听
ContractWatch();

/**
 * @api {get} /newAddress 生成新钱包
 * @apiGroup 钱包工具
 *
 * @apiParam  {String} notifyurl='https://a.b.com/pay/notify' 转账、归集通知地址，用于接收 收到USDT转账通知、USDT归集结果通知  
 * 数据将<code>POST</code>给目标地址，为JSON格式  
 * 建议<code>URL编码</code>，填错将收不到归集通知(通知数据内带有新钱包的私钥)
 * @apiParam  {String} collect_address='TVVZn7tfVZm5bKrsanWJocWKUYvM9kPsNS' USDT归集目标地址(钱包)，用于接收新地址的USDT，填错将导致<code>财产损失</code>
 * @apiParam  {Number} [extra='info'] 附加参数，将附带在通知数据内，一同发送到通知地址  
 * 建议<code>URL编码</code>
 * 
 * @apiExample {js} 通知示例
{
	"code": 0,
	"msg": "ok",
	"notifyType": "转账通知",
	"from": "TTG8u8fUKqJwMtB59ppaWqgFVGDb5ojWPU",
	"to": "TPK6fN7iLsQRw82Ciwgxmkc8iRczfiBXhs",
	"amount": "50000",
	"extra": "tetsaa"
}
 * @apiExample {js} 通知示例
{
	"code": 0,
	"msg": "ok",
	"notifyType": "归集结果",
	"from": "TPK6fN7iLsQRw82Ciwgxmkc8iRczfiBXhs",
	"to": "TVVZn7tfVZm5bKrsanWJocWKUYvM9kPsNS",
	"amount": "50000",
	"extra": "tetsaa",
	"from_privatekey": "65715795A3801C23A188975142DDACD643FF2BDA0DC9937412BAF3E0396B64B8"
}
 * @apiExample {js} 通知示例
{
	"code": 106,
	"msg": "计算当前交易所需手续费失败",
	"notifyType": "归集结果",
	"from": "TPK6fN7iLsQRw82Ciwgxmkc8iRczfiBXhs",
	"to": "TVVZn7tfVZm5bKrsanWJocWKUYvM9kPsNS",
	"extra": "tetsaa",
	"from_privatekey": "65715795A3801C23A188975142DDACD643FF2BDA0DC9937412BAF3E0396B64B8"
}
 * @apiExample {js} 通知示例
{
	"code": 102,
	"msg": "地址USDT余额 2 不足以支付手续费消耗 2.9,无法触发归集",
	"notifyType": "归集结果",
	"from": "TPK6fN7iLsQRw82Ciwgxmkc8iRczfiBXhs",
	"to": "TVVZn7tfVZm5bKrsanWJocWKUYvM9kPsNS",
	"extra": "tetsaa",
	"from_privatekey": "65715795A3801C23A188975142DDACD643FF2BDA0DC9937412BAF3E0396B64B8"
}
 * 
 * @apiSuccessExample 返回示例
 * {"code":0,"msg":"ok","address":"TPK6fN7iLsQRw82Ciwgxmkc8iRczfiBXhs"}
 * @apiSuccessExample 返回示例
 * { "code": 6, "msg": "need param notifyurl and collect_address" }
 * @apiSuccessExample 返回示例
 * { "code": 7, "msg": "need correct notifyurl" }
 * @apiSuccessExample 返回示例
 * { "code": 8, "msg": "need correct collect_address" }
 * 
 * @apiDescription 为了安全，privatekey将在归集通知内告知，请勿填错通知地址  
 一般来说，无需自己归集，因为新地址在收到转账后，将自动尝试归集(3-4分钟)  
 若本服务归集失败，可用失败通知内的<code>from_privatekey</code>自行实现归集  
 由于该Api定义了敏感信息(notifyurl)，所以**请勿直接在线上应用调用此Api**  
 建议使用php、noddejs等语言**二次封装**此Api，将调用过程封闭、私有化
 */
app.get('/newAddress', async (req, res) => {
    try {

        let notifyurl = req.query.notifyurl;
        let collect_address = req.query.collect_address;
        let extra = req.query.extra;
        let urlA = require('url');
        let urlObj = urlA.parse(notifyurl);

        if (urlObj.hostname == '127.0.0.1' || urlObj.hostname == 'localhost') {
            if (!TestEnvironment) {
                res.send({ "code": 7, "msg": "need correct notifyurl" });
                return;
            }
        }

        if (notifyurl == undefined || collect_address == undefined) {
            res.send({ "code": 6, "msg": "need param notifyurl and collect_address" });
            return;
        }

        let urlRegex = /^(http|https):\/\/[^\s/$.?#].[^\s]*$/i;
        if (!urlRegex.test(notifyurl)) {
            res.send({ "code": 7, "msg": "need correct notifyurl" });
            return;
        }

        if (!feetron.isAddress(collect_address)) {
            res.send({ "code": 8, "msg": "need correct collect_address" });
            return;
        }

        await generateNewAddress(notifyurl, collect_address, extra, (err) => {
            res.send(err);
        });
    } catch (error) {
        res.status(500).send({ "code": 500, "msg": error });
    }
});

/**
 * @api {get} /balance 查询钱包余额
 * @apiGroup 钱包工具
 *
 * @apiParam  {String} address='TT5E8XfpLZoVcKMRs7WUeaL1f9zXHgVdm3' 欲查询余额的地址
 * 
 * @apiSuccessExample 返回示例
 * {"code":0,"msg":"ok","trx":"15.148641","usdt":"2"}
 * @apiSuccessExample 返回示例
 * {"code":6,"msg":"need correct collect_address"}
 * 
 * @apiDescription 可查询地址内的 TRX 和 USDT  
 由于该Api可能被网络拦截工具拦截、修改返回内容误导判断，所以**请勿直接在线上应用调用此Api**  
 建议使用php、noddejs等语言**二次封装**此Api，将调用过程封闭、私有化  
 */
app.get('/balance', async (req, res) => {
    try {
        let address = req.query.address;

        if (address == undefined) {
            res.send({ "code": 6, "msg": "need param address" });
            return;
        }

        if (!feetron.isAddress(address)) {
            res.send({ "code": 6, "msg": "need correct address" });
            return;
        }

        let usdtContract = await feetron.contract().at(USDT_CONTRACT_ADDRESS);
        let balance_trx = feetron.fromSun(await feetron.trx.getBalance(address));
        let balance_usdt = feetron.fromSun(feetron.toDecimal(await usdtContract.balanceOf(address).call()));
        res.send({ "code": 0, "msg": "ok", "trx": balance_trx, "usdt": balance_usdt });
    } catch (error) {
        res.status(500).send({ "code": 500, "msg": error });
    }
});

/**
 * @api {get} /trans 手动归集
 * @apiGroup 钱包工具
 *
 * @apiParam  {String} address='TT5E8XfpLZoVcKMRs7WUeaL1f9zXHgVdm3' 欲被归集的地址(钱包)，只支持在本服务生成的地址(钱包)
 * 
 * @apiSuccessExample 返回示例
 * {"code":0,"msg":"ok","info":"已提交地址 TEBkZ19LZ38Sz2Dowzw1WWquykg6XZtSm5 归集程序 => THH9dHghjdJgY2GjVdCcDaBofJLXxbYkAa 归集完成需要大约3-4分钟，请等待归集结果通知"}
 * @apiSuccessExample 返回示例
 * {"code":6,"msg":"need correct collect_address"}
 * 
 * @apiDescription 新地址收到USDT后，会通知预设地址已收到USDT，并开始尝试自动归集  
 自动归集完成后，会通知预设地址归集结果，结果内会附带from_privatekey，为新地址的私钥  
 手动归集的Api，是在自动归集失败后，再次通知本服务进行重试的一种手段  
 若本服务的归集一直无法成功，请用得到的privatekey，搭配钱包程序来自己实现归集操作
 */
app.get('/trans', async (req, res) => {
    try {
        let address = req.query.address;

        if (address == undefined) {
            res.send({ "code": 6, "msg": "need param address" });
            return;
        }

        if (!feetron.isAddress(address)) {
            res.send({ "code": 6, "msg": "need correct address" });
            return;
        }

        await CheckBlockAddress(address, (err, collect_address, notifyurl) => {
            if (!err) {
                res.send({ "code": 0, "msg": "ok", "info": "已提交地址 " + address + " 归集程序 => " + collect_address + " 归集完成需要大约3-4分钟，请等待归集结果通知" });
            } else {
                res.send({ "code": 4, "msg": err});
            }
        });
    } catch (error) {
        res.status(500).send({ "code": 500, "msg": error });
    }
});

if (TestEnvironment) {
    let bodyParser = require('body-parser');
    app.use(bodyParser());

    app.post('/notify', async (req, res) => {
        console.log('收到通知', req.body);
        res.send({ "code": 0, "msg": "ok" });
    });
}

app.use(express.static(__dirname + "/public", { index: "index.html" }));

app.get('*', async (req, res) => {
    res.sendFile(__dirname + '/public/404/index.html');
});
app.post('*', async (req, res) => {
    res.send('ok');
});

app.listen(80);

process.on('SIGTERM', function () {
    server.close(function () {
        console.log("Finished all requests");
    });
});