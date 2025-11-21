/**
 * 네이버 플레이스 URL에서 placeId 추출
 * - 모바일/PC/공유링크/지도 링크 모두 대응
 */
export function extractPlaceId(url: string): string | null {
  if (!url) return null;

  try {
    // 1) place/1234567890 형태 (가장 정확함)
    const p1 = url.match(/place\/(\d{5,12})/);
    if (p1) return p1[1];

    // 2) restaurant/1234567890/home (모바일)
    const p2 = url.match(/restaurant\/(\d{5,12})\//);
    if (p2) return p2[1];

    // 3) /1234567/home? 사이트
    const p3 = url.match(/\/(\d{5,12})\/home/);
    if (p3) return p3[1];

    // 4) code=1234567 형태
    const p4 = url.match(/code=(\d{5,12})/);
    if (p4) return p4[1];

    // 5) !topId=1234567 같은 공유 링크
    const p5 = url.match(/topId=(\d{5,12})/);
    if (p5) return p5[1];

    // 6) fallback: URL 안에 등장하는 7~12자리 숫자 중
    //    가장 "중간에 위치하는" 숫자를 placeId로 간주
    const candidates = url.match(/\d{7,12}/g);
    if (candidates && candidates.length > 0) {
      return candidates[0]; // 첫 번째 후보 사용
    }

    return null;
  } catch (err) {
    console.error("❌ extractPlaceId Error:", err);
    return null;
  }
}
