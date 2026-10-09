/**
 * ที่ตั้งโครงการ (ฉบับไทย) — การ์ดขนาดกะทัดรัดอยู่ข้างข้อมูลโครงการ
 *
 * แทน ProjectLocationPanel เดิมที่เป็นแผนที่เต็มความกว้างสูง 32rem แต่มีข้อมูลน้อย
 * การ์ดนี้แสดงแผนที่ขนาดพอดี ที่อยู่ พิกัด และลิงก์ Google Maps / นำทาง ซึ่งเป็น
 * สิ่งที่โฟร์แมน จัดซื้อ และผู้ส่งของใช้จริง
 *
 * แผนที่ (maplibre ~1 MB) โหลดเมื่อการ์ดเลื่อนเข้ามาในจอเท่านั้น
 * พิกัดที่ geocode ได้จะบันทึกกลับเข้าโครงการครั้งเดียว เหมือนตัวเดิม
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MapPin, Navigation, ExternalLink, Copy, Check } from 'lucide-react';
import { Card, ProjectMap } from '@/shared/ui';
import { apiPatch } from '@/shared/lib/api';
import type { Project } from '../api';

type LatLng = { lat: number; lng: number };

function finitePoint(lat: unknown, lng: unknown): LatLng | null {
  return typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

/** true เมื่อ element เข้ามาใกล้ viewport (เผื่อ 200px) — ใช้หน่วงการโหลดแผนที่ */
function useNearViewport<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref as React.RefObject<T>, near];
}

export function ProjectLocationCard({ project }: { project: Project }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const addr = project.address ?? null;
  const stored = finitePoint(addr?.lat, addr?.lng);
  const [point, setPoint] = useState<LatLng | null>(stored);
  const [persisted, setPersisted] = useState(stored !== null);
  const [copied, setCopied] = useState(false);
  const [mapRef, mapVisible] = useNearViewport<HTMLDivElement>();

  useEffect(() => {
    if (stored) setPoint(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.lat, stored?.lng]);

  const persist = useMutation({
    mutationFn: (c: LatLng) =>
      apiPatch(`/v1/projects/${project.id}`, { address: { ...(addr ?? {}), lat: c.lat, lng: c.lng } }),
    onSuccess: () => {
      setPersisted(true);
      queryClient.invalidateQueries({ queryKey: ['project', project.id] });
    },
  });

  const lines = [addr?.street, [addr?.postal_code, addr?.city].filter(Boolean).join(' '), addr?.state, addr?.country]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  const label = lines.join(', ');
  const hasLocation = lines.length > 0 || stored !== null;

  const query = point ? `${point.lat},${point.lng}` : label;
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
  const coordText = point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : null;

  const copyCoords = () => {
    if (!coordText) return;
    navigator.clipboard?.writeText(coordText).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  return (
    <Card padding="none" className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-content-primary">
          <MapPin size={15} className="text-oe-blue" aria-hidden />
          {t('th_ui.project.location')}
        </h2>
        {hasLocation && (
          <a
            href={gmapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-oe-blue hover:underline"
          >
            {t('th_ui.project.open_gmaps')}
            <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>

      {hasLocation ? (
        <>
          <div ref={mapRef} className="relative mx-4 min-h-[13rem] flex-1 overflow-hidden rounded-lg bg-surface-secondary">
            {mapVisible && (
              <ProjectMap
                variant="detail"
                lat={stored?.lat ?? null}
                lng={stored?.lng ?? null}
                address={addr?.street}
                city={addr?.city}
                country={addr?.country}
                label={label}
                className="h-full min-h-[13rem] rounded-lg border-0"
                onResolved={(c) => {
                  setPoint(c);
                  if (!persisted && !persist.isPending) persist.mutate(c);
                }}
              />
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-3 px-4 pb-4 pt-3">
            {label && <p className="text-sm leading-relaxed text-content-primary">{label}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={directionsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-oe-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-oe-blue-hover"
              >
                <Navigation size={13} aria-hidden />
                {t('th_ui.project.directions')}
              </a>
              {coordText && (
                <button
                  type="button"
                  onClick={copyCoords}
                  title={t('th_ui.project.copy_coords')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-light px-2.5 py-1.5 font-mono text-[11px] text-content-secondary tabular-nums hover:bg-surface-secondary"
                >
                  {copied ? <Check size={12} className="text-semantic-success" /> : <Copy size={12} />}
                  {copied ? t('th_ui.project.copied') : coordText}
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="m-4 mt-1 flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-medium p-6 text-center">
          <MapPin size={20} className="text-content-quaternary" aria-hidden />
          <p className="text-sm text-content-secondary">{t('th_ui.project.no_location')}</p>
          <Link to={`/projects/${project.id}/settings`} className="text-xs font-medium text-oe-blue hover:underline">
            {t('th_ui.project.set_location')}
          </Link>
        </div>
      )}
    </Card>
  );
}
