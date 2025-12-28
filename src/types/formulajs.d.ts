declare module 'formulajs' {
  // Math and Statistical Functions
  export function ABS(value: number): number;
  export function AVERAGE(...args: number[]): number;
  export function CEILING(number: number, significance: number): number;
  export function COUNT(...args: unknown[]): number;
  export function FLOOR(number: number, significance: number): number;
  export function INT(number: number): number;
  export function MAX(...args: number[]): number;
  export function MIN(...args: number[]): number;
  export function MOD(number: number, divisor: number): number;
  export function POWER(number: number, power: number): number;
  export function RAND(): number;
  export function ROUND(number: number, digits: number): number;
  export function ROUNDDOWN(number: number, digits: number): number;
  export function ROUNDUP(number: number, digits: number): number;
  export function SQRT(number: number): number;
  export function SUM(...args: number[]): number;
  export function SUMIF(range: unknown[], criteria: unknown, sumRange?: unknown[]): number;

  // Text Functions
  export function CHAR(number: number): string;
  export function CLEAN(text: string): string;
  export function CODE(text: string): number;
  export function CONCATENATE(...args: string[]): string;
  export function EXACT(text1: string, text2: string): boolean;
  export function FIND(findText: string, withinText: string, startNum?: number): number;
  export function LEFT(text: string, numChars?: number): string;
  export function LEN(text: string): number;
  export function LOWER(text: string): string;
  export function MID(text: string, startNum: number, numChars: number): string;
  export function PROPER(text: string): string;
  export function REPLACE(oldText: string, startNum: number, numChars: number, newText: string): string;
  export function REPT(text: string, numberTimes: number): string;
  export function RIGHT(text: string, numChars?: number): string;
  export function SEARCH(findText: string, withinText: string, startNum?: number): number;
  export function SUBSTITUTE(text: string, oldText: string, newText: string, instance?: number): string;
  export function TEXT(value: unknown, formatText: string): string;
  export function TRIM(text: string): string;
  export function UPPER(text: string): string;
  export function VALUE(text: string): number;

  // Logical Functions
  export function AND(...args: boolean[]): boolean;
  export function FALSE(): boolean;
  export function IF(condition: boolean, valueIfTrue: unknown, valueIfFalse: unknown): unknown;
  export function IFERROR(value: unknown, valueIfError: unknown): unknown;
  export function IFNA(value: unknown, valueIfNA: unknown): unknown;
  export function IFS(...args: unknown[]): unknown;
  export function NOT(logical: boolean): boolean;
  export function OR(...args: boolean[]): boolean;
  export function SWITCH(expression: unknown, ...args: unknown[]): unknown;
  export function TRUE(): boolean;
  export function XOR(...args: boolean[]): boolean;

  // Date and Time Functions
  export function DATE(year: number, month: number, day: number): Date;
  export function DATEVALUE(dateText: string): number;
  export function DAY(date: Date | number): number;
  export function DAYS(endDate: Date | number, startDate: Date | number): number;
  export function HOUR(date: Date | number): number;
  export function MINUTE(date: Date | number): number;
  export function MONTH(date: Date | number): number;
  export function NOW(): Date;
  export function SECOND(date: Date | number): number;
  export function TIME(hour: number, minute: number, second: number): number;
  export function TODAY(): Date;
  export function WEEKDAY(date: Date | number, type?: number): number;
  export function YEAR(date: Date | number): number;

  // Lookup Functions
  export function CHOOSE(index: number, ...values: unknown[]): unknown;
  export function HLOOKUP(lookupValue: unknown, tableArray: unknown[][], rowIndex: number, rangeLookup?: boolean): unknown;
  export function INDEX(array: unknown[][], rowNum: number, colNum?: number): unknown;
  export function MATCH(lookupValue: unknown, lookupArray: unknown[], matchType?: number): number;
  export function VLOOKUP(lookupValue: unknown, tableArray: unknown[][], colIndex: number, rangeLookup?: boolean): unknown;

  // Information Functions
  export function ISBLANK(value: unknown): boolean;
  export function ISERROR(value: unknown): boolean;
  export function ISEVEN(number: number): boolean;
  export function ISLOGICAL(value: unknown): boolean;
  export function ISNA(value: unknown): boolean;
  export function ISNONTEXT(value: unknown): boolean;
  export function ISNUMBER(value: unknown): boolean;
  export function ISODD(number: number): boolean;
  export function ISTEXT(value: unknown): boolean;
  export function N(value: unknown): number;
  export function NA(): Error;
  export function TYPE(value: unknown): number;

  // Allow any other functions
  const formulajs: Record<string, (...args: unknown[]) => unknown>;
  export default formulajs;
}
