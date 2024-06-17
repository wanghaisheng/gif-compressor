/**
 * Reference: https://github.com/image-size/image-size/blob/main/lib/types/svg.ts
 */

import { homeState } from "@/states/home";
import { Dimension, ProcessOutput } from "./ImageBase";
import { AvifImage } from "./AvifImage";
import { Mimes } from "@/mimes";

type IAttributes = {
  width: number | null;
  height: number | null;
  viewbox?: IAttributes | null;
};

const svgReg = /<svg\s([^>"']|"[^"]*"|'[^']*')*>/;

const extractorRegExps = {
  height: /\sheight=(['"])([^%]+?)\1/,
  root: svgReg,
  viewbox: /\sviewBox=(['"])(.+?)\1/i,
  width: /\swidth=(['"])([^%]+?)\1/,
};

const INCH_CM = 2.54;
const units: { [unit: string]: number } = {
  in: 96,
  cm: 96 / INCH_CM,
  em: 16,
  ex: 8,
  m: (96 / INCH_CM) * 100,
  mm: 96 / INCH_CM / 10,
  pc: 96 / 72 / 12,
  pt: 96 / 72,
  px: 1,
};

const unitsReg = new RegExp(
  `^([0-9.]+(?:e\\d+)?)(${Object.keys(units).join("|")})?$`,
);

function parseLength(len: string) {
  const m = unitsReg.exec(len);
  if (!m) {
    return undefined;
  }
  return Math.round(Number(m[1]) * (units[m[2]] || 1));
}

function parseViewbox(viewbox: string): IAttributes {
  const bounds = viewbox.split(" ");
  return {
    height: parseLength(bounds[3]) as number,
    width: parseLength(bounds[2]) as number,
  };
}

function parseAttributes(root: string): IAttributes {
  const width = root.match(extractorRegExps.width);
  const height = root.match(extractorRegExps.height);
  const viewbox = root.match(extractorRegExps.viewbox);
  return {
    height: height && (parseLength(height[2]) as number),
    viewbox: viewbox && (parseViewbox(viewbox[2]) as IAttributes),
    width: width && (parseLength(width[2]) as number),
  };
}

function calculateByDimensions(attrs: IAttributes): Dimension {
  return {
    height: attrs.height as number,
    width: attrs.width as number,
  };
}

function calculateByViewbox(
  attrs: IAttributes,
  viewbox: IAttributes,
): Dimension {
  const ratio = (viewbox.width as number) / (viewbox.height as number);
  if (attrs.width) {
    return {
      height: Math.floor(attrs.width / ratio),
      width: attrs.width,
    };
  }
  if (attrs.height) {
    return {
      height: attrs.height,
      width: Math.floor(attrs.height * ratio),
    };
  }
  return {
    height: viewbox.height as number,
    width: viewbox.width as number,
  };
}

export function getSvgDimension(input: string): Dimension {
  const root = input.match(extractorRegExps.root);
  if (root) {
    const attrs = parseAttributes(root[0]);
    if (attrs.width && attrs.height) {
      return calculateByDimensions(attrs);
    }
    if (attrs.viewbox) {
      return calculateByViewbox(attrs, attrs.viewbox);
    }
  }
  throw new TypeError("Invalid SVG");
}

/**
 * Convert SVG type to other, SVG convert can't do in worker
 * @param input SVG compress result in worker
 * @returns
 */
export async function svgConvert(input: ProcessOutput): Promise<ProcessOutput> {
  if (!homeState.option.format.target) {
    return input;
  }
  const target = homeState.option.format.target.toLowerCase();
  const canvas = document.createElement("canvas");
  canvas.width = input.width;
  canvas.height = input.height;
  const context = canvas.getContext("2d")!;
  if (["jpg", "jpeg"].includes(target)) {
    context.fillStyle = homeState.option.format.transparentFill;
    context.fillRect(0, 0, input.width, input.height);
  }
  const svg = await new Promise<HTMLImageElement>((resolve) => {
    const img = new Image();
    img.src = input.src;
    img.onload = () => resolve(img);
  });
  context.drawImage(
    svg,
    0,
    0,
    input.width,
    input.height,
    0,
    0,
    input.width,
    input.height,
  );

  // Convert svg to target type
  let blob: Blob;
  if (target === "avif") {
    blob = await AvifImage.encode(
      context,
      input.width,
      input.height,
      homeState.option.avif.quality,
      homeState.option.avif.speed,
    );
  } else {
    blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob(
        (result) => {
          resolve(result!);
        },
        Mimes[target],
        1,
      );
    });
  }
  input.blob = blob;
  input.src = URL.createObjectURL(blob);
  return input;
}
