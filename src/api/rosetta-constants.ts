import * as T from '@blockstack/stacks-blockchain-api-types';
import { ChainID } from '@stacks/transactions';
import { testnet } from 'bitcoinjs-lib/types/networks';

export const RosettaNetworks = {
  testnet: 'testnet',
  mainnet: 'mainnet',
};

export const RosettaConstants = {
  blockchain: 'stacks',
  rosettaVersion: '1.4.6',
  symbol: 'STX',
  decimals: 6,
  lockedBalance: 'LockedBalance',
  spendableBalance: 'SpendableBalance',
};

export const ReferenceNodes: { [key: string]: any } = {
  mainnet: {
    host: 'seed-2.mainnet.stacks.co',
    port: '20443',
  },
};

export function getRosettaNetworkName(chainId: ChainID): string {
  if (chainId === ChainID.Mainnet) {
    return RosettaNetworks.mainnet;
  } else if (chainId === ChainID.Testnet) {
    return RosettaNetworks.testnet;
  } else {
    throw new Error(`Cannot get rosetta network for unexpected chainID "${chainId}"`);
  }
}

export const RosettaOperationTypes = [
  'token_transfer',
  'contract_call',
  'smart_contract',
  'coinbase',
  'poison_microblock',
  'fee',
];

export const RosettaOperationStatuses = [
  {
    status: 'success',
    successful: true,
  },
  {
    status: 'pending',
    successful: true,
  },
  {
    status: 'abort_by_response',
    successful: false,
  },
  {
    status: 'abort_by_post_condition',
    successful: false,
  },
];

export enum RosettaErrorsTypes {
  invalidAccount,
  insufficientFunds,
  accountEmpty,
  invalidBlockIndex,
  blockNotFound,
  invalidBlockHash,
  transactionNotFound,
  invalidTransactionHash,
  invalidParams,
  invalidNetwork,
  invalidBlockchain,
  unknownError,
  emptyNetworkIdentifier,
  emptyAccountIdentifier,
  invalidBlockIdentifier,
  invalidTransactionIdentifier,
  emptyBlockchain,
  emptyNetwork,
  invalidCurveType,
  invalidPublicKey,
  invalidOperation,
  invalidFee,
  invalidCurrencySymbol,
  invalidCurrencyDecimals,
  invalidTransactionType,
  invalidSender,
  invalidRecipient,
  invalidTransactionString,
  transactionNotSigned,
  invalidAmount,
  invalidFees,
  emptyPublicKey,
  noSignatures,
  invalidSignature,
  signatureNotVerified,
  needOnePublicKey,
  needOnlyOneSignature,
  signatureTypeNotSupported,
  missingTransactionSize,
}

// All possible errors
export interface RosettaError {
  code: number;
  message: string;
  retriable: boolean;
  details?: Record<string, string>;
}

export const RosettaErrors: Record<RosettaErrorsTypes, RosettaError> = {
  [RosettaErrorsTypes.invalidAccount]: {
    code: 601,
    message: 'Invalid Account.',
    retriable: true,
  },
  [RosettaErrorsTypes.insufficientFunds]: {
    code: 602,
    message: 'Insufficient Funds.',
    retriable: false,
  },
  [RosettaErrorsTypes.accountEmpty]: {
    code: 603,
    message: 'Account is empty.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidBlockIndex]: {
    code: 604,
    message: 'Invalid block index.',
    retriable: false,
  },
  [RosettaErrorsTypes.blockNotFound]: {
    code: 605,
    message: 'Block not found.',
    retriable: true,
  },
  [RosettaErrorsTypes.invalidBlockHash]: {
    code: 606,
    message: 'Invalid block hash.',
    retriable: true,
  },
  [RosettaErrorsTypes.transactionNotFound]: {
    code: 607,
    message: 'Transaction not found.',
    retriable: true,
  },
  [RosettaErrorsTypes.invalidTransactionHash]: {
    code: 608,
    message: 'Invalid transaction hash.',
    retriable: true,
  },
  [RosettaErrorsTypes.invalidParams]: {
    code: 609,
    message: 'Invalid params.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidNetwork]: {
    code: 610,
    message: 'Invalid network.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidBlockchain]: {
    code: 611,
    message: 'Invalid blockchain.',
    retriable: false,
  },
  [RosettaErrorsTypes.unknownError]: {
    code: 612,
    message: 'Unknown error.',
    retriable: false,
  },
  [RosettaErrorsTypes.emptyNetworkIdentifier]: {
    code: 613,
    message: 'Network identifier object is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.emptyAccountIdentifier]: {
    code: 614,
    message: 'Account identifier object is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidBlockIdentifier]: {
    code: 615,
    message: 'Block identifier is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidTransactionIdentifier]: {
    code: 616,
    message: 'Transaction identifier is null.',
    retriable: true,
  },
  [RosettaErrorsTypes.emptyBlockchain]: {
    code: 617,
    message: 'Blockchain name is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.emptyNetwork]: {
    code: 618,
    message: 'Network name is null.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidCurveType]: {
    code: 619,
    message: 'Invalid curve type.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidPublicKey]: {
    code: 620,
    message: 'invalid public key.',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidOperation]: {
    code: 621,
    message: 'Invalid operation',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidFee]: {
    code: 622,
    message: 'Invalid fee',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidCurrencySymbol]: {
    code: 623,
    message: 'Invalid symbol',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidCurrencyDecimals]: {
    code: 624,
    message: 'Invalid currency decimals',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidTransactionType]: {
    code: 625,
    message: 'Invalid transaction type',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidSender]: {
    code: 626,
    message: 'Invalid sender address',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidRecipient]: {
    code: 627,
    message: 'Invalid recipient address',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidTransactionString]: {
    code: 628,
    message: 'Invalid transaction string',
    retriable: false,
  },
  [RosettaErrorsTypes.transactionNotSigned]: {
    code: 629,
    message: 'Transaction not signed',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidAmount]: {
    code: 630,
    message: 'Amount not available',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidFees]: {
    code: 631,
    message: 'Fees not available',
    retriable: false,
  },
  [RosettaErrorsTypes.emptyPublicKey]: {
    code: 632,
    message: 'Public key not available',
    retriable: false,
  },
  [RosettaErrorsTypes.noSignatures]: {
    code: 633,
    message: 'no signature found',
    retriable: false,
  },
  [RosettaErrorsTypes.invalidSignature]: {
    code: 634,
    message: 'Invalid Signature',
    retriable: false,
  },
  [RosettaErrorsTypes.signatureNotVerified]: {
    code: 635,
    message: 'Signature(s) not verified with this public key(s)',
    retriable: false,
  },
  [RosettaErrorsTypes.needOnePublicKey]: {
    code: 636,
    message: 'Need one public key for single signature',
    retriable: false,
  },
  [RosettaErrorsTypes.needOnlyOneSignature]: {
    code: 637,
    message: 'Need only one signature',
    retriable: false,
  },
  [RosettaErrorsTypes.signatureTypeNotSupported]: {
    code: 638,
    message: 'Signature type not supported.',
    retriable: false,
  },
  [RosettaErrorsTypes.missingTransactionSize]: {
    code: 638,
    message: 'Transaction size required to calculate total fee.',
    retriable: false,
  },
};

// All request types, used to validate input.
export type RosettaRequestType =
  | T.RosettaAccountBalanceRequest
  | T.RosettaBlockRequest
  | T.RosettaBlockTransactionRequest
  | T.RosettaMempoolTransactionRequest
  | T.RosettaMempoolTransactionRequest
  | T.RosettaNetworkListRequest
  | T.RosettaOptionsRequest
  | T.RosettaStatusRequest;

export interface SchemaFiles {
  request: string;
  response: string;
}

export const RosettaSchemas: Record<string, SchemaFiles> = {
  '/rosetta/v1/network/list': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-network-list-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-network-list-response.schema.json',
  },
  '/rosetta/v1/network/options': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-network-options-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-network-options-response.schema.json',
  },
  '/rosetta/v1/network/status': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-network-status-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-network-status-response.schema.json',
  },
  '/rosetta/v1/block': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-block-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-block-response.schema.json',
  },
  '/rosetta/v1/block/transaction': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-block-transaction-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-block-transaction-response.schema.json',
  },
  '/rosetta/v1/mempool': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-mempool-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-mempool-response.schema.json',
  },
  '/rosetta/v1/mempool/transaction': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-mempool-transaction-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-mempool-transaction-response.schema.json',
  },
  '/rosetta/v1/account/balance': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-account-balance-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-account-response.schema.json',
  },
  '/rosetta/v1/construction/derive': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-derive-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-derive-response.schema.json',
  },
  '/rosetta/v1/construction/preprocess': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-preprocess-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-preprocess-response.schema.json',
  },
  '/rosetta/v1/construction/metadata': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-metadata-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-metadata-response.schema.json',
  },
  '/rosetta/v1/construction/hash': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-hash-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-hash-response.schema.json',
  },
  '/rosetta/v1/construction/parse': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-parse-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-parse-response.schema.json',
  },
  '/rosetta/v1/construction/submit': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-submit-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-submit-response.schema.json',
  },
  '/rosetta/v1/construction/payloads': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-payloads-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-payloads-response.schema.json',
  },
  '/rosetta/v1/construction/combine': {
    request:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-combine-request.schema.json',
    response:
      '@blockstack/stacks-blockchain-api-types/api/rosetta/rosetta-construction-combine-response.schema.json',
  },
};
