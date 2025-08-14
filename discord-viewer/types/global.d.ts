declare global {
  var updateStocksData: ((data: any) => void) | undefined;
  var sendValidationUpdate: ((ticker: string, validation: any) => void) | undefined;
}

export {};
