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

/**
 * 구글 지도 URL에서 place_id 추출
 * - https://www.google.com/maps/place/?q=place_id:XXXX
 * - ...&query_place_id=XXXX
 * - ...place_id=XXXX
 * - 공유 링크의 !1sXXXX! 패턴
 */
export function extractGooglePlaceId(url: string): string | null {
  if (!url) return null;
  try {
    const decoded = (() => {
      try {
        return decodeURIComponent(url);
      } catch {
        return url;
      }
    })();

    // place_id 명시
    const p1 = decoded.match(/place_id[:=]([A-Za-z0-9_-]+)/);
    if (p1) return p1[1];

    const p2 = decoded.match(/query_place_id=([A-Za-z0-9_-]+)/);
    if (p2) return p2[1];

    // 공유 링크의 !1s<id>!
    const p3 = decoded.match(/!1s([A-Za-z0-9_-]+)!/);
    if (p3) return p3[1];

    // cid (16진) 패턴
    const cid = decoded.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
    if (cid) return cid[0]; // place_id는 아니지만 crawler가 cid를 처리

    // /g/<shortId> 패턴 (예: .../16s%2Fg%2F1vrq7k1h)
    const p4 = decoded.match(/\/g\/([A-Za-z0-9_-]+)/);
    if (p4) return p4[1];

    return null;
  } catch (err) {
    console.error("❌ extractGooglePlaceId Error:", err);
    return null;
  }
}

/**
 * 카카오맵 URL에서 placeId(숫자) 추출
 * 예: https://place.map.kakao.com/8401632
 */
export function extractKakaoPlaceId(url: string): string | null {
  if (!url) return null;
  try {
    const decoded = (() => {
      try {
        return decodeURIComponent(url);
      } catch {
        return url;
      }
    })();

    const m1 = decoded.match(/place\.map\.kakao\.com\/(\d{3,12})/);
    if (m1) return m1[1];

    const m2 = decoded.match(/\/(\d{3,12})(?:[/?]|$)/);
    if (m2) return m2[1];

    return null;
  } catch (err) {
    console.error("❌ extractKakaoPlaceId Error:", err);
    return null;
  }
}
