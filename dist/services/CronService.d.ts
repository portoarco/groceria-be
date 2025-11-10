declare class CronService {
    static runOrderCancellationJob(): Promise<void>;
    static startOrderCancellationJob(): void;
    static runOrderAutoConfirmationJob(): Promise<void>;
    static startOrderAutoConfirmationJob(): void;
}
export default CronService;
//# sourceMappingURL=CronService.d.ts.map