import { ObjectId } from "mongodb";

export type Comparator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'IN' | 'NOT IN';
export type QueryValue = string | number | boolean | Date | Array<string | number | boolean | Date | ObjectId> | ObjectId;
export type QueryCondition = {
  [key: string]: QueryValue | { [key in Comparator]?: QueryValue };
};