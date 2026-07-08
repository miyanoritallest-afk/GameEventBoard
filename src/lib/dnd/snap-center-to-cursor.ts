import type { Modifier } from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";

/**
 * ドラッグ中のオーバーレイ（持ち上げゴースト）の中心を、常にカーソル位置へ吸着させる modifier。
 *
 * 既定の DragOverlay は、掴んだ元カードの左上を基準にゴーストを追従させる。
 * このため横長のカード（幅の広いメンバーカード・チームカード）の「右側」を掴むと、
 * 幅を固定した狭いゴーストがカーソルのはるか左に出てしまい、指とゴーストが大きくズレる。
 *
 * この modifier は、掴んだ瞬間のポインタ座標（activatorEvent）とゴーストの矩形
 * （draggingNodeRect）から、ゴーストの中心が掴んだ座標に一致するよう transform を補正する。
 * 以降はその補正を保ったまま delta で追従するため、カードのどこを掴んでも
 * ゴーストの中心が常に指の下に来る（@dnd-kit/modifiers の snapCenterToCursor 相当・依存追加なし）。
 */
export const snapCenterToCursor: Modifier = ({
  activatorEvent,
  draggingNodeRect,
  transform,
}) => {
  if (!draggingNodeRect || !activatorEvent) {
    return transform;
  }

  const activatorCoordinates = getEventCoordinates(activatorEvent);
  if (!activatorCoordinates) {
    return transform;
  }

  // 掴んだ座標（画面座標）と、ゴースト矩形の中心とのオフセット。
  // このオフセット分だけ transform をずらすと、ゴースト中心が掴んだ座標に一致する。
  const offsetX = activatorCoordinates.x - draggingNodeRect.left;
  const offsetY = activatorCoordinates.y - draggingNodeRect.top;

  return {
    ...transform,
    x: transform.x + offsetX - draggingNodeRect.width / 2,
    y: transform.y + offsetY - draggingNodeRect.height / 2,
  };
};
