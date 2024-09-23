type IdField = 'id' | '_id';
type IdType = { [K in IdField]: number | string };

export interface JobExecutionLog extends IdType {
    jobId: string;
    runAt: Date;
    finishedAt: Date;
    result: 'success' | 'fail';
    error: string | null;
}
