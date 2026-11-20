// Every message the editor can show, in one place, with the tone of Orca's own copy.

export const MESSAGES = {
  opening: 'Opening…',
  empty: 'The file is empty.',
  short: 'The file is too short to be a parquet file.',
  notParquet:
    'This file is not a parquet file: it does not carry parquet magic bytes. Orca can show it as text in the Source tab.',
  encrypted:
    'This file is encrypted (parquet modular encryption), which the viewer cannot open. Use parquet-tools or DuckDB to read it.',
  truncated: 'The file appears truncated: its footer is cut off.',
  damaged:
    'The file is damaged: its footer does not parse as parquet metadata. It may be truncated or corrupted.',
  noColumns: 'The file has no columns to show.',
  noRows: 'The file has a schema but no rows.',
  readFailed: 'The file could not be read.',
  loadingRows: 'Reading rows…',
  sorting: 'Sorting rows…',
  sortedBy: (name, direction) => `Sorted by ${name}, ${direction > 0 ? 'ascending' : 'descending'}.`,
  sortColumnFailed: (reason) => `This column cannot be read, so the rows cannot be sorted by it. ${reason}`,
  sortCleared: 'File order restored.',
  unsupportedEncoding: (encoding) =>
    `The file uses the ${encoding} data page encoding, which the viewer cannot read yet.`,
  unsupportedCodec: (codec, where) =>
    `The file uses the ${codec} compression codec${where ? ` in ${where}` : ''}, which the viewer cannot read yet. ` +
    'Save a copy with snappy, gzip, zstd or uncompressed to view it here.',
  partiallyUnsupported: (codecs) =>
    `Parts of this file use ${codecs} compression, which the viewer cannot read yet; those cells show as unavailable.`
}
