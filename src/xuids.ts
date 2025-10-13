// Xuids in either wrapped or unwrapped form
const xuidRegex = /(xuid\()?(\d+)\)?/i;

export function wrapXuid(xuid: string) {
  const regexResult = xuid.match(xuidRegex);
  if (regexResult == null) {
    throw new Error(`Invalid xuid: ${xuid}`);
  }
  return `xuid(${regexResult[2]})`;
}

export function unwrapXuid(xuid: string) {
  const regexResult = xuid.match(xuidRegex);
  if (regexResult == null) {
    throw new Error(`Invalid xuid: ${xuid}`);
  }
  return regexResult[2];
}

export function compareXuids(xuid1: string, xuid2: string) {
  if (xuid1 === xuid2) {
    return true;
  }

  const regexResults = [xuid1.match(xuidRegex), xuid2.match(xuidRegex)];

  if (regexResults[0] == null || regexResults[1] == null) {
    // At least one of the xuids is not valid
    return false;
  } else {
    return regexResults[0][2] === regexResults[1][2];
  }
}
