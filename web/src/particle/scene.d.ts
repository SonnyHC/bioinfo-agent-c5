export const themes: Record<string,Record<string,number[]>>;
export function mountHelix(canvas: HTMLCanvasElement, options?: {theme?:string;onState?:(state:string)=>void}): {
  dispose():void;
  pause(value?:boolean):void;
  refresh():void;
  configure(value:{brush?:number;projection?:string;materials?:Record<string,number[]>}):void;
} | null;
