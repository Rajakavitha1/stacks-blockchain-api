import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import * as BigNum from 'bn.js';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { DbBlock, DbTx, DbMempoolTx, DbTxStatus, DbTxTypeId } from '../datastore/common';
import * as assert from 'assert';
import {
  AuthType,
  ChainID,
  createStacksPrivateKey,
  getPublicKey,
  makeSTXTokenTransfer,
  makeUnsignedSTXTokenTransfer,
  pubKeyfromPrivKey,
  publicKeyToString,
  SignedTokenTransferOptions,
  standardPrincipalCV,
  TransactionSigner,
  UnsignedMultiSigTokenTransferOptions,
  UnsignedTokenTransferOptions,
} from '@stacks/transactions';
import { StacksTestnet } from '@stacks/network';
import * as BN from 'bn.js';
import { getCoreNodeEndpoint, StacksCoreRpcClient } from '../core-rpc/client';
import { bufferToHexPrefixString, digestSha512_256 } from '../helpers';
import {
  RosettaConstructionCombineRequest,
  RosettaConstructionCombineResponse,
  RosettaAccount,
  RosettaAccountBalanceRequest,
  RosettaAccountBalanceResponse,
  RosettaAccountIdentifier,
  RosettaAmount,
  RosettaConstructionDeriveRequest,
  RosettaConstructionDeriveResponse,
  RosettaConstructionHashRequest,
  RosettaConstructionHashResponse,
  RosettaConstructionMetadataRequest,
  RosettaConstructionParseRequest,
  RosettaConstructionParseResponse,
  RosettaConstructionPayloadsRequest,
  RosettaConstructionPreprocessRequest,
  RosettaConstructionPreprocessResponse,
  RosettaMempoolRequest,
  RosettaMempoolResponse,
  RosettaMempoolTransactionRequest,
  RosettaMempoolTransactionResponse,
  RosettaOperation,
  RosettaTransaction,
} from '@blockstack/stacks-blockchain-api-types';
import {
  getRosettaNetworkName,
  RosettaConstants,
  RosettaErrors,
  RosettaErrorsTypes,
  RosettaOperationTypes,
  RosettaOperationStatuses,
} from '../api/rosetta-constants';
import { getStacksTestnetNetwork, testnetKeys } from '../api/routes/debug';
import { getOptionsFromOperations, getSignature } from '../rosetta-helpers';
import { makeSigHashPreSign, MessageSignature } from '@stacks/transactions';

describe('Rosetta API', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let eventServer: Server;
  let api: ApiServer;

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    eventServer = await startEventServer({ db, chainId: ChainID.Testnet });
    api = await startApiServer(db, ChainID.Testnet);
  });

  test('network/list', async () => {
    const query1 = await supertest(api.server).post(`/rosetta/v1/network/list`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      network_identifiers: [{ blockchain: 'stacks', network: 'testnet' }],
    });
  });

  test('network/options', async () => {
    const nodeVersion = process.version;
    const middlewareVersion = require('../../package.json').version;
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/network/options`)
      .send({ network_identifier: { blockchain: 'stacks', network: 'testnet' } });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      version: {
        rosetta_version: '1.4.6',
        node_version: nodeVersion,
        middleware_version: middlewareVersion,
      },
      allow: {
        operation_statuses: RosettaOperationStatuses,
        operation_types: RosettaOperationTypes,
        errors: Object.values(RosettaErrors),
        historical_balance_lookup: true,
      },
    });
  });

  test('network/options - bad request', async () => {
    const query1 = await supertest(api.server).post(`/rosetta/v1/network/options`).send({});
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      code: 613,
      message: 'Network identifier object is null.',
      retriable: false,
      details: { message: "should have required property 'network_identifier'" },
    });
  });

  test('network/status - invalid blockchain', async () => {
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/network/status`)
      .send({ network_identifier: { blockchain: 'bitcoin', network: 'testnet' } });
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      code: 611,
      message: 'Invalid blockchain.',
      retriable: false,
    });
  });

  test('network/status - invalid network', async () => {
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/network/status`)
      .send({ network_identifier: { blockchain: 'stacks', network: 'mainnet' } });
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      code: 610,
      message: 'Invalid network.',
      retriable: false,
    });
  });

  test('network/status', async () => {
    // skip first a block (so we are at least N+1 blocks)
    await new Promise<DbBlock>(resolve =>
      api.datastore.once('blockUpdate', block => resolve(block))
    );
    const block = await new Promise<DbBlock>(resolve =>
      api.datastore.once('blockUpdate', block => resolve(block))
    );
    const genesisBlock = await api.datastore.getBlockByHeight(1);
    assert(genesisBlock.found);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/network/status`)
      .send({ network_identifier: { blockchain: 'stacks', network: 'testnet' } });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      current_block_identifier: {
        index: block.block_height,
        hash: block.block_hash,
      },
      current_block_timestamp: block.burn_block_time * 1000,
      genesis_block_identifier: {
        index: genesisBlock.result.block_height,
        hash: genesisBlock.result.block_hash,
      },
      peers: [],
    });
  });

  test('block - by index', async () => {
    const blockHeight = 2;
    const block = await api.datastore.getBlockByHeight(blockHeight);
    assert(block.found);
    const txs = await api.datastore.getBlockTxsRows(block.result.block_hash);
    assert(txs.found);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: blockHeight },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      block: {
        block_identifier: {
          index: blockHeight,
          hash: block.result.block_hash,
        },
        parent_block_identifier: {
          index: blockHeight - 1,
          hash: block.result.parent_block_hash,
        },
        timestamp: block.result.burn_block_time * 1000,
        transactions: [
          {
            transaction_identifier: {
              hash: txs.result[0].tx_id,
            },
            operations: [
              {
                operation_identifier: { index: 0 },
                type: 'coinbase',
                status: 'success',
                account: { address: txs.result[0].sender_address },
              },
            ],
          },
        ],
      },
    });
  });

  test('block - by hash', async () => {
    const blockHeight = 2;
    const block = await api.datastore.getBlockByHeight(blockHeight);
    assert(block.found);
    const txs = await api.datastore.getBlockTxsRows(block.result.block_hash);
    assert(txs.found);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { hash: block.result.block_hash },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      block: {
        block_identifier: {
          index: blockHeight,
          hash: block.result.block_hash,
        },
        parent_block_identifier: {
          index: blockHeight - 1,
          hash: block.result.parent_block_hash,
        },
        timestamp: block.result.burn_block_time * 1000,
        transactions: [
          {
            transaction_identifier: {
              hash: txs.result[0].tx_id,
            },
            operations: [
              {
                operation_identifier: { index: 0 },
                type: 'coinbase',
                status: 'success',
                account: { address: txs.result[0].sender_address },
              },
            ],
          },
        ],
      },
    });
  });

  test('block - get latest', async () => {
    const block = await api.datastore.getCurrentBlock();
    assert(block.found);
    const txs = await api.datastore.getBlockTxsRows(block.result.block_hash);
    assert(txs.found);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: {},
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      block: {
        block_identifier: {
          index: block.result.block_height,
          hash: block.result.block_hash,
        },
        parent_block_identifier: {
          index: block.result.block_height - 1,
          hash: block.result.parent_block_hash,
        },
        timestamp: block.result.burn_block_time * 1000,
        transactions: [
          {
            transaction_identifier: {
              hash: txs.result[0].tx_id,
            },
            operations: [
              {
                operation_identifier: { index: 0 },
                type: 'coinbase',
                status: 'success',
                account: { address: txs.result[0].sender_address },
              },
            ],
          },
        ],
      },
    });
  });

  test('block/transaction', async () => {
    let expectedTxId: string = '';
    const broadcastTx = new Promise<DbTx>(resolve => {
      const listener: (info: DbTx | DbMempoolTx) => void = info => {
        if (info.tx_id === expectedTxId && info.status === DbTxStatus.Success) {
          api.datastore.removeListener('txUpdate', listener);
          resolve(info as DbTx);
        }
      };
      api.datastore.addListener('txUpdate', listener);
    });
    const transferTx = await makeSTXTokenTransfer({
      recipient: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      amount: new BN(3852),
      senderKey: 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01',
      network: getStacksTestnetNetwork(),
      memo: 'test1234',
    });
    expectedTxId = '0x' + transferTx.txid();
    const submitResult = await new StacksCoreRpcClient().sendTransaction(transferTx.serialize());
    expect(submitResult.txId).toBe(expectedTxId);
    await broadcastTx;
    const txDb = await api.datastore.getTx(expectedTxId);
    assert(txDb.found);
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: txDb.result.block_height, hash: txDb.result.block_hash },
        transaction_identifier: { hash: txDb.result.tx_id },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      transaction_identifier: {
        hash: txDb.result.tx_id,
      },
      operations: [
        {
          operation_identifier: { index: 0 },
          type: 'fee',
          status: 'success',
          account: { address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR' },
          amount: { value: '-180', currency: { symbol: 'STX', decimals: 6 } },
        },
        {
          operation_identifier: { index: 1 },
          type: 'token_transfer',
          status: 'success',
          account: { address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR' },
          amount: { value: '-3852', currency: { symbol: 'STX', decimals: 6 } },
          coin_change: {
            coin_action: 'coin_spent',
            coin_identifier: {
              identifier: `${txDb.result.tx_id}:1`,
            },
          },
        },
        {
          operation_identifier: { index: 2 },
          related_operations: [{ index: 1 }],
          type: 'token_transfer',
          status: 'success',
          account: { address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP' },
          amount: { value: '3852', currency: { symbol: 'STX', decimals: 6 } },
          coin_change: {
            coin_action: 'coin_created',
            coin_identifier: {
              identifier: `${txDb.result.tx_id}:2`,
            },
          },
        },
      ],
    });
  });

  test('block/transaction - invalid transaction hash', async () => {
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 3, hash: '0x3a' },
        transaction_identifier: { hash: '3' },
      });
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      code: 608,
      message: 'Invalid transaction hash.',
      retriable: true,
    });
  });

  test('rosetta/mempool list', async () => {
    const mempoolTxs: DbMempoolTx[] = [];
    for (let i = 0; i < 10; i++) {
      const mempoolTx: DbMempoolTx = {
        pruned: false,
        tx_id: `0x891200000000000000000000000000000000000000000000000000000000000${i}`,
        nonce: 0,
        raw_tx: Buffer.from('test-raw-tx'),
        type_id: DbTxTypeId.Coinbase,
        receipt_time: (new Date(`2020-07-09T15:14:0${i}Z`).getTime() / 1000) | 0,
        coinbase_payload: Buffer.from('coinbase hi'),
        status: 1,
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: 1234n,
        sponsored: false,
        sender_address: 'sender-addr',
        origin_hash_mode: 1,
      };
      mempoolTxs.push(mempoolTx);
    }
    await db.updateMempoolTxs({ mempoolTxs });

    const request1: RosettaMempoolRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
    };
    const searchResult1 = await supertest(api.server).post('/rosetta/v1/mempool/').send(request1);

    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1: RosettaMempoolResponse = {
      transaction_identifiers: [
        {
          hash: '0x8912000000000000000000000000000000000000000000000000000000000007',
        },
        {
          hash: '0x8912000000000000000000000000000000000000000000000000000000000006',
        },
        {
          hash: '0x8912000000000000000000000000000000000000000000000000000000000005',
        },
      ],
    };

    const result: RosettaMempoolResponse = JSON.parse(searchResult1.text);

    expect(result).toHaveProperty('transaction_identifiers');

    expect(result.transaction_identifiers).toEqual(
      expect.arrayContaining(expectedResp1.transaction_identifiers)
    );
  });

  test('rosetta/mempool/transaction', async () => {
    const mempoolTx: DbMempoolTx = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      nonce: 0,
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Success,
      receipt_time: 1594307695,
      coinbase_payload: Buffer.from('coinbase hi'),
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: 1234n,
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const request1: RosettaMempoolTransactionRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      transaction_identifier: { hash: mempoolTx.tx_id },
    };

    const searchResult1 = await supertest(api.server)
      .post(`/rosetta/v1/mempool/transaction/`)
      .send(request1);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');

    const rosettaAccount: RosettaAccount = {
      address: 'sender-addr',
    };

    const rosettaOperation: RosettaOperation = {
      operation_identifier: {
        index: 0,
      },
      status: 'success',
      type: 'coinbase',
      account: rosettaAccount,
    };
    const rosettaOperations: RosettaOperation[] = [];
    rosettaOperations.push(rosettaOperation);
    const transaction: RosettaTransaction = {
      operations: rosettaOperations,
      transaction_identifier: {
        hash: mempoolTx.tx_id,
      },
    };

    const expectedResp1: RosettaMempoolTransactionResponse = {
      transaction: transaction,
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('account/balance success', async () => {
    const request1: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      },
    };

    const result1 = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request1);
    console.log('account balance', result1.text);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');

    const curren_block = await api.datastore.getCurrentBlock();
    assert(curren_block.found);

    const amount: RosettaAmount = {
      value: '10000000000003852',
      currency: {
        symbol: 'STX',
        decimals: 6,
      },
    };

    const expectedResponse: RosettaAccountBalanceResponse = {
      block_identifier: {
        hash: curren_block.result.block_hash,
        index: curren_block.result.block_height,
      },
      balances: [amount],

      metadata: {
        sequence_number: 0,
      },
    };

    expect(JSON.parse(result1.text)).toEqual(expectedResponse);
  });

  test('account/balance - fees calculated properly', async () => {
    // this account has made one transaction
    // ensure that the fees for it are calculated after it makes
    // the transaction, not before, by checking its balance in block 1
    const stxAddress = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR';
    const request1: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      block_identifier: {
        index: 1,
      },
      account_identifier: {
        address: stxAddress,
      },
    };

    const result1 = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request1);
    console.log('account balance', result1.text);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');

    const block = await api.datastore.getBlockByHeight(1);
    assert(block.found);

    const amount: RosettaAmount = {
      value: '10000000000000000',
      currency: {
        symbol: 'STX',
        decimals: 6,
      },
    };

    const expectedResponse: RosettaAccountBalanceResponse = {
      block_identifier: {
        hash: block.result.block_hash,
        index: block.result.block_height,
      },
      balances: [amount],

      metadata: {
        sequence_number: 1,
      },
    };

    expect(JSON.parse(result1.text)).toEqual(expectedResponse);
  });

  test('account/balance - invalid account identifier', async () => {
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'KK',
        metadata: {},
      },
    };

    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 601,
      message: 'Invalid Account.',
      retriable: true,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('account/balance - empty block identifier', async () => {
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        metadata: {},
      },
      block_identifier: {},
    };

    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 615,
      message: 'Block identifier is null.',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('account/balance - invalid block hash', async () => {
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        metadata: {},
      },
      block_identifier: {
        hash: 'afd',
      },
    };
    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 606,
      message: 'Invalid block hash.',
      retriable: true,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  /* rosetta construction api tests below */

  test('construction/derive', async () => {
    const request: RosettaConstructionDeriveRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const accountIdentifier: RosettaAccountIdentifier = {
      address: 'ST19SH1QSCR8VMEX6SVWP33WCF08RPDY5QVHX94BM',
    };
    const expectResponse: RosettaConstructionDeriveResponse = {
      account_identifier: accountIdentifier,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);

    const request2 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'this is an invalid curve type',
        hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
      },
    };

    const result2 = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request2);
    expect(result2.status).toBe(400);

    const expectedResponse2 = RosettaErrors[RosettaErrorsTypes.invalidCurveType];

    expect(JSON.parse(result2.text)).toEqual(expectedResponse2);

    const request3 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: 'this is an invalid public key',
      },
    };

    const result3 = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request3);
    expect(result3.status).toBe(400);

    const expectedResponse3 = RosettaErrors[RosettaErrorsTypes.invalidPublicKey];

    expect(JSON.parse(result3.text)).toEqual(expectedResponse3);
  });

  test('construction/preprocess', async () => {
    const request: RosettaConstructionPreprocessRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {},
      max_fee: [
        {
          value: '12380898',
          currency: {
            symbol: 'STX',
            decimals: 6,
          },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 1,
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectResponse: RosettaConstructionPreprocessResponse = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: null,
        suggested_fee_multiplier: 1,
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
      required_public_keys: [
        {
          address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        },
      ],
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/preprocess - failure', async () => {
    const request2 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'invalid operation type',
          status: null,
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {},
      max_fee: [
        {
          value: '12380898',
          currency: {
            symbol: 'STX',
            decimals: 6,
          },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 1,
    };

    const result2 = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request2);
    expect(result2.status).toBe(400);

    const expectedResponse2 = RosettaErrors[RosettaErrorsTypes.invalidOperation];

    expect(JSON.parse(result2.text)).toEqual(expectedResponse2);
  });

  test('construction/metadata - success', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: testnetKeys[0].stacksAddress,
        type: 'token_transfer',
        status: null,
        suggested_fee_multiplier: 1,
        token_transfer_recipient_address: testnetKeys[1].stacksAddress,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
      public_keys: [{ hex_bytes: publicKey, curve_type: 'secp256k1' }],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    console.log(result.text);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(JSON.parse(result.text)).toHaveProperty('metadata');
    expect(JSON.parse(result.text)).toHaveProperty('suggested_fee');
    expect(JSON.parse(result.text).suggested_fee.value).toBe('180');
  });

  test('construction/metadata - failure invalid public key', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[2].secretKey))
    );
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: testnetKeys[0].stacksAddress,
        type: 'token_transfer',
        status: null,
        token_transfer_recipient_address: testnetKeys[1].stacksAddress,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
      public_keys: [
        {
          hex_bytes: publicKey,
          curve_type: 'secp256k1',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    expect(JSON.parse(result.text)).toEqual(RosettaErrors[RosettaErrorsTypes.invalidPublicKey]);
  });

  test('construction/metadata - empty network identifier', async () => {
    const request = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: null,
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 613,
      message: 'Network identifier object is null.',
      retriable: false,
      details: {
        message: "should have required property 'network_identifier'",
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid transfer type', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token',
        status: null,
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 625,
      message: 'Invalid transaction type',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid sender address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'abc',
        type: 'token_transfer',
        status: null,
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
        size: 180,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 626,
      message: 'Invalid sender address',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid recipient address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: null,
        token_transfer_recipient_address: 'xyz',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        max_fee: '12380898',
        size: 180,
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 627,
      message: 'Invalid recipient address',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/hash', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      signed_transaction:
        '0x80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b400017a33a91515ef48608a99c6adecd2eb258e11534a1acf66348f5678c8e2c8f83d243555ed67a0019d3500df98563ca31321c1a675b43ef79f146e322fe08df75103020000000000051a1ae3f911d8f1d46d7416bfbe4b593fd41eac19cb000000000007a12000000000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(200);

    const expectedResponse: RosettaConstructionHashResponse = {
      transaction_identifier: {
        hash: '0xf3b054a5fbae98f7f35e5e917b65759fc365a3e073f8af1c3b8d211b286fa74a',
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - no `0x` prefix', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      signed_transaction:
        '0x80800000000400d429e0b599f9cba40ecc9f219df60f9d0a02212d000000000000000100000000000000000101cc0235071690bc762d0013f6d3e4be32aa8f8d01d0db9d845595589edba47e7425bd655f20398e3d931cbe60eea59bb66f44d3f28443078fe9d10082dccef80c010200000000040000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(200);

    const expectedResponse: RosettaConstructionHashResponse = {
      transaction_identifier: {
        hash: '0x592fad4733f3e5c65e7dd9c82ad848191993a80cb3d891b6514bda6e3e7a239e',
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - odd number of hex digits', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      signed_transaction:
        '80800000000400d429e0b599f9cba40ecc9f219df60f9d0a02212d000000000000000100000000000000000101cc0235071690bc762d0013f6d3e4be32aa8f8d01d0db9d845595589edba47e7425bd655f20398e3d931cbe60eea59bb66f44d3f28443078fe9d10082dccef80c01020000000004000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidTransactionString];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - unsigned transaction', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      //unsigned transaction bytes
      signed_transaction:
        '0x80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003020000000000051a1ae3f911d8f1d46d7416bfbe4b593fd41eac19cb000000000007a12000000000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.transactionNotSigned];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/parse - signed', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const senderAddr = testnetKeys[0].stacksAddress;
    const recipientAddr = 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0';
    const amount = new BN(1000);
    const fee = new BN(180);
    const options: SignedTokenTransferOptions = {
      recipient: recipientAddr,
      amount: amount,
      fee: fee,
      senderKey: testnetKeys[0].secretKey,
      network: getStacksTestnetNetwork(),
    };
    const testTransaction = await makeSTXTokenTransfer(options);
    const request: RosettaConstructionParseRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      signed: true,
      transaction: bufferToHexPrefixString(testTransaction.serialize()),
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/parse`).send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const actual: RosettaConstructionParseResponse = JSON.parse(result.text);
    // test fee operation
    expect(actual.operations[0].account?.address).toEqual(senderAddr);
    expect(actual.operations[0].amount?.value).toEqual('-' + fee.toString());
    // test sender
    expect(actual.operations[1].account?.address).toEqual(senderAddr);
    expect(actual.operations[1].amount?.value).toEqual('-' + amount.toString());
    // test recipient
    expect(actual.operations[2].account?.address).toEqual(recipientAddr);
    expect(actual.operations[2].amount?.value).toEqual(amount.toString());
    // test signer
    expect(actual.account_identifier_signers?.[0].address).toEqual(senderAddr);
  });

  test('construction/parse - unsigned', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const senderAddr = testnetKeys[0].stacksAddress;
    const recipientAddr = 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0';
    const amount = new BN(1000);
    const fee = new BN(180);
    const tokenTransferOptions: UnsignedTokenTransferOptions = {
      recipient: recipientAddr,
      amount: amount,
      fee: fee,
      publicKey: publicKey,
      network: getStacksTestnetNetwork(),
    };
    const testTransaction = await makeUnsignedSTXTokenTransfer(tokenTransferOptions);

    const request: RosettaConstructionParseRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      signed: false,
      transaction: bufferToHexPrefixString(testTransaction.serialize()),
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/parse`).send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    const actual: RosettaConstructionParseResponse = JSON.parse(result.text);
    // test fee operation
    expect(actual.operations[0].account?.address).toEqual(senderAddr);
    expect(actual.operations[0].amount?.value).toEqual('-' + fee.toString());
    // test sender
    expect(actual.operations[1].account?.address).toEqual(senderAddr);
    expect(actual.operations[1].amount?.value).toEqual('-' + amount.toString());
    // test recipient
    expect(actual.operations[2].account?.address).toEqual(recipientAddr);
    expect(actual.operations[2].amount?.value).toEqual(amount.toString());
  });

  test('construction/submit', async () => {
    const txOptions = {
      senderKey: testnetKeys[0].secretKey,
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: new BigNum(12345),
      network: getStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: new BigNum(0),
      fee: new BigNum(200),
    };

    const transaction = await makeSTXTokenTransfer(txOptions);
    const serializedTx = transaction.serialize().toString('hex');

    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      // signed transaction bytes
      signed_transaction: '0x' + serializedTx,
    };
    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/submit`)
      .send(request);
    expect(result.status).toBe(200);
  });

  test('construction/submit - unsigned', async () => {
    const txOptions = {
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: new BigNum(12345),
      publicKey: publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey)),
      network: getStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: new BigNum(0),
      fee: new BigNum(200),
    };

    const transaction = await makeUnsignedSTXTokenTransfer(txOptions);
    const serializedTx = transaction.serialize().toString('hex');

    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: getRosettaNetworkName(ChainID.Testnet),
      },
      //unsigned transaction bytes
      signed_transaction: '0x' + serializedTx,
    };
    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/submit`)
      .send(request);
    expect(result.status).toBe(400);
    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidTransactionString];

    console.log(expectedResponse);

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('payloads single sign success', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));
    const sender = testnetKeys[0].stacksAddress;
    const recipient = testnetKeys[1].stacksAddress;
    const fee = '180';

    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: recipient,
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        fee: fee,
      },
      public_keys: [
        {
          hex_bytes: publicKey,
          curve_type: 'secp256k1',
        },
      ],
    };

    const tokenTransferOptions: UnsignedTokenTransferOptions = {
      recipient: recipient,
      amount: new BN('500000'),
      fee: new BN(fee),
      publicKey: publicKey,
      network: getStacksTestnetNetwork(),
      nonce: new BN(0),
    };

    const transaction = await makeUnsignedSTXTokenTransfer(tokenTransferOptions);
    const unsignedTransaction = transaction.serialize();
    // const hexBytes = digestSha512_256(unsignedTransaction).toString('hex');

    const signer = new TransactionSigner(transaction);

    const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, new BN(fee), new BN(0));

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const accountIdentifier: RosettaAccountIdentifier = {
      address: sender,
    };

    const expectedResponse = {
      unsigned_transaction: '0x' + unsignedTransaction.toString('hex'),
      payloads: [
        {
          address: sender,
          account_identifier: accountIdentifier,
          hex_bytes: prehash,
          signature_type: 'ecdsa_recovery',
        },
      ],
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('payloads multi sig', async () => {
    const publicKey1 = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));
    const publicKey2 = publicKeyToString(pubKeyfromPrivKey(testnetKeys[1].secretKey));

    const sender = testnetKeys[0].stacksAddress;
    const recipient = testnetKeys[1].stacksAddress;
    const fee = '180';

    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: sender,
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: recipient,
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        fee,
      },
      public_keys: [
        {
          hex_bytes: publicKey1,
          curve_type: 'secp256k1',
        },
        {
          hex_bytes: publicKey2,
          curve_type: 'secp256k1',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.needOnePublicKey];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('payloads public key not added', async () => {
    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        fee: '180',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.emptyPublicKey];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('payloads public key invalid curve type', async () => {
    const request: RosettaConstructionPayloadsRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: null,
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {
        fee: '180',
      },
      public_keys: [
        {
          hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
          curve_type: 'edwards25519',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/payloads`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidCurveType];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine single sign success', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));

    const txOptions: UnsignedTokenTransferOptions = {
      publicKey: publicKey,
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: new BigNum(12345),
      network: getStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: new BigNum(0),
      fee: new BigNum(200),
    };

    const unsignedTransaction = await makeUnsignedSTXTokenTransfer(txOptions);
    const unsignedSerializedTx = unsignedTransaction.serialize().toString('hex');

    const accountInfo = await new StacksCoreRpcClient().getAccount(testnetKeys[0].stacksAddress);

    const signer = new TransactionSigner(unsignedTransaction);

    const prehash = makeSigHashPreSign(signer.sigHash, AuthType.Standard, new BN(200), new BN(0));

    signer.signOrigin(createStacksPrivateKey(testnetKeys[0].secretKey));
    const signedSerializedTx = signer.transaction.serialize().toString('hex');

    const signature: MessageSignature = getSignature(signer.transaction) as MessageSignature;

    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction: '0x' + unsignedSerializedTx,
      signatures: [
        {
          signing_payload: {
            hex_bytes: prehash,
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: publicKey,
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes: signature.data.slice(2) + signature.data.slice(0, 2),
        },
      ],
    };

    console.log('Request combine', request);
    console.log('Signing Payload', request.signatures[0].signing_payload);
    console.log('Signing public key', request.signatures[0].public_key);

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectedResponse: RosettaConstructionCombineResponse = {
      signed_transaction: '0x' + signedSerializedTx,
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine multi sig', async () => {
    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction:
        '00000000010400539886f96611ba3ba6cef9618f8c78118b37c5be0000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003020000000000051ab71a091b4b8b7661a661c620966ab6573bc2dcd3000000000007a12074657374207472616e73616374696f6e000000000000000000000000000000000000',
      signatures: [
        {
          signing_payload: {
            hex_bytes:
              '017c7fc676effda9d905440a052d304b5d9705c30625e654f5b3c9ed461337cdec695d14e5f24091d61f8409f2ab703102ca840dbf5ef752ec534fe1f418552201',
            signature_type: 'ecdsa',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa',
          hex_bytes:
            '017c7fc676effda9d905440a052d304b5d9705c30625e654f5b3c9ed461337cdec695d14e5f24091d61f8409f2ab703102ca840dbf5ef752ec534fe1f418552201',
        },
        {
          signing_payload: {
            hex_bytes:
              '017c7fc676effda9d905440a052d304b5d9705c30625e654f5b3c9ed461337cdec695d14e5f24091d61f8409f2ab703102ca840dbf5ef752ec534fe1f418552201',
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes:
            '017c7fc676effda9d905440a052d304b5d9705c30625e654f5b3c9ed461337cdec695d14e5f24091d61f8409f2ab703102ca840dbf5ef752ec534fe1f418552201',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.needOnlyOneSignature];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine invalid transaction', async () => {
    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction: 'invalid transaction',
      signatures: [
        {
          signing_payload: {
            hex_bytes:
              '36212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f01',
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes:
            '36212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f01',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidTransactionString];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine invalid signature', async () => {
    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction:
        '00000000010400539886f96611ba3ba6cef9618f8c78118b37c5be0000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003020000000000051ab71a091b4b8b7661a661c620966ab6573bc2dcd3000000000007a12074657374207472616e73616374696f6e000000000000000000000000000000000000',
      signatures: [
        {
          signing_payload: {
            hex_bytes: 'invalid signature',
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes: 'invalid signature',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.invalidSignature];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine signature not verified', async () => {
    const publicKey = publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey));

    const txOptions: UnsignedTokenTransferOptions = {
      publicKey: publicKey,
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: new BigNum(12345),
      network: getStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: new BigNum(0),
      fee: new BigNum(200),
    };

    const unsignedTransaction = await makeUnsignedSTXTokenTransfer(txOptions);
    const unsignedSerializedTx = unsignedTransaction.serialize().toString('hex');

    const signer = new TransactionSigner(unsignedTransaction);
    signer.signOrigin(createStacksPrivateKey(testnetKeys[1].secretKey)); // use different secret key to sign

    const signature = getSignature(unsignedTransaction);
    if (!signature) throw Error('Signature undefined');

    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction: unsignedSerializedTx,
      signatures: [
        {
          signing_payload: {
            hex_bytes: signature.data,
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes: signature.data,
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.signatureNotVerified];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('combine invalid public key', async () => {
    const request: RosettaConstructionCombineRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      unsigned_transaction:
        '80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b4000136212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f03020000000000051ab71a091b4b8b7661a661c620966ab6573bc2dcd3000000000007a12074657374207472616e73616374696f6e000000000000000000000000000000000000',
      signatures: [
        {
          signing_payload: {
            hex_bytes:
              '36212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f01',
            signature_type: 'ecdsa_recovery',
          },
          public_key: {
            hex_bytes: 'invalid  public key',
            curve_type: 'secp256k1',
          },
          signature_type: 'ecdsa_recovery',
          hex_bytes:
            '36212600bf7463399a23c398f29ca7006b9986b4a01129dd7c6e89314607208e516b0b28c1d850fe6e164abea7b6cceb4aa09700a6d218d1b605d4a402d3038f01',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/combine`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectedResponse = RosettaErrors[RosettaErrorsTypes.signatureNotVerified];

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  /* rosetta construction end */

  afterAll(async () => {
    await new Promise<void>(resolve => eventServer.close(() => resolve()));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
