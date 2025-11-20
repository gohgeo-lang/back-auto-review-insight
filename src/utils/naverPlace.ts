export function extractPlaceId(url: string): string | null {
  try {
    // 1) place/{숫자}
    const match1 = url.match(/place\/(\d+)/);
    if (match1) return match1[1];

    // 2) code={숫자}
    const match2 = url.match(/code=(\d+)/);
    if (match2) return match2[1];

    // 3) /(\d+)/home
    const match3 = url.match(/\/(\d+)\/home/);
    if (match3) return match3[1];

    // 4) 숫자 7자리 이상이 URL에 포함되어 있으면 그걸 placeId로 간주
    const match4 = url.match(/(\d{6,12})/);
    if (match4) return match4[1];

    return null;
  } catch {
    return null;
  }
}
