import { globalSlipBoard as globalSlipBoard_, type SlipBoard } from "octagonal-wheels/bureau/SlipBoard";

declare global {
    interface Slips extends LSSlips {
        _dummy: undefined;
    }
}
export const globalSlipBoard = globalSlipBoard_ as SlipBoard<Slips>;
