"use client";

import {useEffect, useState, type ReactNode} from "react";
import {useSite} from "./site-context";

export function useStaffAvatar(path?: string, bucket?: string | null) {
  const {client, user} = useSite();
  const managed = bucket === "gary-home-profile-photos";
  const key = client && user && path && managed ? user.id + ":" + path : "";
  const [downloaded, setDownloaded] = useState({key: "", url: ""});
  useEffect(() => {
    if (!key || !client || !path) return;
    let active = true;
    let url = "";
    void client.storage.from("gary-home-profile-photos").download(path).then(({data}) => {
      if (!active || !data) return;
      url = URL.createObjectURL(data);
      setDownloaded({key, url});
    }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [client, key, path]);

  if (!client || !path) return "";
  if (managed) return downloaded.key === key ? downloaded.url : "";
  return client.storage.from("staff-avatars").getPublicUrl(path).data.publicUrl;
}

export function StaffAvatarImage({path, bucket, fallback}: {path?: string; bucket?: string | null; fallback: ReactNode}) {
  const url = useStaffAvatar(path, bucket);
  const [failed, setFailed] = useState("");
  return url && url !== failed
    ? <img src={url} alt="" decoding="async" onError={() => setFailed(url)}/>
    : fallback;
}
