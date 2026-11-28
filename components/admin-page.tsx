"use client";
import { AnimatePresence } from "motion/react";
import { PortalHelp, PortalHelpStart } from "./portal-help";
import { DelayedLattice, SessionGate } from "./page-loading";
import { ContentImage } from "./content-image";
import { ServiceAppsMenu } from "./service-apps";
import { PasswordInput } from "./password-input";
import { useListingProvenance } from "./use-listing-provenance";
import { listingCreationTime } from "@/lib/listing-provenance";
import { SeoAuditDashboard } from "./seo-audit-dashboard";
import { PropertySeoPanel, HomepageSeoPanel } from "./seo-draft-panels";
import { EditorialManager } from "./editorial-manager";
import { RentalContentManager } from "./rental-content-manager";
import { RentalPropertyFields } from "./rental-property-fields";
import { AMENITIES, RENTAL_TYPES, isPublicRental, typeLabel, listingCode } from "@/lib/rentals";
import { SelectField } from "./select-field";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Building2, Check, ChevronRight, ContactRound, Eye, FileText, House, Image as ImageIcon, KeyRound, LayoutDashboard, LogOut, Mail, MapPin, Trash2, MessageSquare, MessageSquareQuote, BadgePercent, Plus, Search, Settings2, Upload, X, RefreshCw, Save, Phone, Users, ShieldCheck, Newspaper, BookOpen, NotebookPen, Images } from "lucide-react";
import { StudioShell } from "./studio-sidebar";
import { useSite } from "./site-context";
import { BranchedMenu,type BranchedMenuItem } from "./react-bits/branched-menu";
import Counter from "./react-bits/counter";
import { PortalSwitcher } from "./portal-access";
import { Brand } from "./site-shell";
import { CANONICAL_SITE_ORIGIN, CUSTOMER_ACCOUNT_URL } from "@/lib/site-origin";
import { localizedPath } from "@/lib/localized-routes";
import { LanguageSwitcher } from "./language-switcher";
import { SitePreferences } from "./site-preferences";
import { useStudioText } from "./use-studio-text";
import { PropertyPriceFields } from "./property-price-fields";
import { PublicUrlField } from "./public-url-field";
import { ListingUrlField } from "./listing-url-field";
import { generateListingSlug, isListingUrlAutomatic, publishedListingUrl } from "@/lib/listing-url";
import { PropertyVideoField } from "./property-video-field";
import { PropertyPhotoGrid } from "./property-photo-grid";
import { addImageFilename, imageFilename, imageFilenameKey, imageOriginalFilename, pruneImageFilenames } from "@/lib/image-filenames";
import { contentAssets } from "@/lib/content-assets";
import { isConflictResponse } from "@/lib/conflict-response";
import { firstPageCount, readAllRows } from "@/lib/pagination";
import { photoMetadata, pruneImageMetadata, type PhotoMetadata } from "@/lib/image-metadata";
import { ListingPhotoUploadStatus, type ListingPhotoUploadProgress } from "./listing-upload-status";
import { useListingGalleryCheckpoint } from "./use-listing-gallery-checkpoint";
import { canResumeGallery, confirmedListingWrite, listingGallery, matchesPlannedPhoto, sameJson, type GalleryCheckpoint, type PlannedListingPhoto } from "@/lib/listing-gallery-checkpoint";
import { EditorModal } from "./editor-modal";
import { preparePropertyImage, uploadPropertyImage, imageUploadError, type PropertyImageUploadOptions } from "@/lib/property-image-upload";
import { PROPERTY_IMAGE_BUCKET, propertyPhotoPath, replacePropertyPhotoUrl } from "@/lib/property-photo-files";
import { remapListingPhotos, syncRenamedListingDraft } from "@/lib/property-photo-rename-state";
import type { PhotoRenameHistory, RenamePhotoResult } from "@/lib/property-photo-rename-server";
import type { PhotoRenameControls } from "./property-photo-rename";
import { propertyVideoUrlError } from "@/lib/property-video";
import { defaultListingAuthorId, resolveListingAuthor } from "@/lib/listing-author-default";
import { formatPropertyPrice, propertyPriceError } from "@/lib/property-pricing";
import { filterStudioListings, type ListingPriceSort } from "@/lib/listing-table";
import { ListingPriceFilter, ListingStatusFilter } from "./listing-column-filters";
import { listingIdError, normalizeListingId, previewListingId } from "@/lib/listing-id";
import { request } from "@/lib/requests";
import { LandlordManager } from "./landlord-manager";
import { SubmissionManager } from "./submission-manager";
import { BackNavigation } from "./back-navigation";
import { CustomerManager } from "./customer-manager";
import { TeamManager, emptyTeamDraft } from "./team-manager";
import { canDeleteContent, canRenamePropertyPhotos, canViewTeam, canReorderProperties } from "@/lib/staff";
import { StaffAccountMenu,StaffPasswordReminder } from "./staff-profile";
import { StudioNotifications } from "./studio-notifications";
import { DeleteConfirmation } from "./delete-confirmation";
import { StorageMediaManagement, listingDeletionMessage, listingDeletionRequest } from "./listing-deletion-queue";
import type { ListingDeletion } from "@/lib/property-deletion-server";
import { hanoiInput, type CustomerSummary } from "@/lib/customer-data";
import type { Enquiry, Neighbourhood, Property, Settings } from "@/lib/types";

type Tab="landlords"|"overview"|"properties"|"enquiries"|"customers"|"media"|"neighbourhoods"|"settings"|"team"|"rental-content"|"feedback"|"assistance"|"news"|"tips"|"help"|"seo";
const tabs:[Tab,string,typeof Building2][]=[["overview","Overview",LayoutDashboard],["seo","SEO Audit",Search],["properties","Listings",House],["enquiries","Enquiries",MessageSquare],["landlords","Introduced properties",FileText],["customers","Client Database",ContactRound],["feedback","Customer feedback",MessageSquareQuote],["assistance","Assistance attribution",BadgePercent],["media","Media library",ImageIcon],["neighbourhoods","Neighbourhoods",MapPin],["settings","Site settings",Settings2],["team","Team access",KeyRound],["rental-content","People & galleries",Images],["news","News articles",Newspaper],["tips","Rental tips",BookOpen],["help","Help & onboarding",BookOpen]];
const amenityOptions=Object.keys(AMENITIES);
const emptyProperty=():Property=>({id:crypto.randomUUID(),slug:"",title_en:"",title_vi:"",description_en:"",description_vi:"",district_slug:"tay-ho",address:"",price:null,price_max:null,price_vnd:null,price_vnd_max:null,currency:"USD",listing_type:"rent",property_type:"Apartment",bedrooms:1,bathrooms:null,area_sqm:null,amenities:[],images:[],featured:false,status:"draft",availability:"on_request",source_url:null,sort_order:100,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});

export function AdminPage() {
  const site=useSite();const {content,setContent,configured,ready,client,user,editor,demo,enterDemo,exitDemo,studioDataReady,enquiries,setEnquiries,notice,refresh,language,editorTask,reconnect,sessionPhase}=site;
  const text=useStudioText();
  const publicHome = CANONICAL_SITE_ORIGIN + localizedPath("/", language);
  const [tab,setTab]=useState<Tab>("properties");
  const posting=useListingProvenance(content.properties.map(row=>row.id),tab==="properties");const [query,setQuery]=useState("");const [status,setStatus]=useState("");const [priceSort,setPriceSort]=useState<ListingPriceSort>("");const [priceMin,setPriceMin]=useState("");const [priceMax,setPriceMax]=useState("");
  const [editing,setEditing]=useState<Property|null>(null);const [newPropertyId,setNewPropertyId]=useState<string|null>(null);const [area,setArea]=useState<Neighbourhood|null>(null);const [newArea,setNewArea]=useState(false);const [lead,setLead]=useState<Enquiry|null>(null);
  const [settingsDraft,setSettingsDraft]=useState<Settings|null>(null);
  const [teamDraft,setTeamDraft]=useState(emptyTeamDraft);
  const [customerDraft,setCustomerDraft]=useState<CustomerSummary|null>(null);
  const [pendingDelete,setPendingDelete]=useState<{kind:"property";id:string;label:string;version:string}|{kind:"enquiry";id:string;label:string}|null>(null),[deleteError,setDeleteError]=useState("");
  const [latestDeletion,setLatestDeletion]=useState<ListingDeletion|null>(null);
  const reading=useRef(new Set<string>());
  const [staffProfileHost,setStaffProfileHost]=useState<HTMLDivElement|null>(null);
  const visibleTabs=tabs.filter(([id])=>id!=="media"&&(id!=="team"||!demo&&canViewTeam(site.staffRole))&&(id!=="assistance"||!demo&&canReorderProperties(site.staffRole)));
  const navigationItem=([value,label,Icon]:[Tab,string,typeof Building2])=>({value,label:text(label),icon:<Icon size={18}/>,badge:value==="enquiries"&&(demo||studioDataReady)?enquiries.filter(e=>!e.read_at).length:undefined});
  const workspaceReady=demo||studioDataReady;
  const sidebarItems:BranchedMenuItem[]=[navigationItem(tabs[0]),
    {value:"rentals",label:text("Rentals & content"),icon:<Building2 size={18}/>,children:visibleTabs.filter(([id])=>["properties","landlords","neighbourhoods","rental-content"].includes(id)).map(navigationItem)},
    {value:"customer-care",label:text("Customer care"),icon:<Users size={18}/>,children:visibleTabs.filter(([id])=>["enquiries","customers","feedback"].includes(id)).map(navigationItem)},
    {value:"publishing",label:text("Assistance & publishing"),icon:<NotebookPen size={18}/>,children:visibleTabs.filter(([id])=>["assistance","news","tips","seo"].includes(id)).map(navigationItem)},
    {value:"administration",label:text("Administration"),icon:<ShieldCheck size={18}/>,children:visibleTabs.filter(([id])=>["settings","team"].includes(id)).map(navigationItem)},
    ...visibleTabs.filter(([id])=>id==="help").map(navigationItem)
  ];
  const [refreshing,setRefreshing]=useState(false);
  const [workspaceLoadFailed,setWorkspaceLoadFailed]=useState(false);
  const lastAccount=useRef<string|null>(null);const currentAccount=useRef(user?.id);useLayoutEffect(()=>{currentAccount.current=user?.id;},[user?.id]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [authBusy,setAuthBusy]=useState(false);const [resetMode,setResetMode]=useState(false);
  const accountId=user?.id;
  const gallery=useListingGalleryCheckpoint(!demo&&editor?accountId:undefined,editing,editorTask);
  const [photoTransfer,setPhotoTransfer]=useState(false);
  const propertySaveFlight=useRef(false);
  const detailFlight=useRef<AbortController|null>(null);
  const [openingProperty,setOpeningProperty]=useState<string|null>(null);
  const [mediaFilenames,setMediaFilenames]=useState<Record<string,Property["image_filenames"]>>({});
  useEffect(()=>()=>{detailFlight.current?.abort();detailFlight.current=null;},[accountId]);
  useEffect(()=>{
    if(tab!=="media"||demo||!accountId||!editor||!workspaceReady)return;
    let active=true;
    void editorTask((db,signal)=>readAllRows((from,to)=>db.from("properties")
      .select("id,image_filenames",firstPageCount(from)).order("id").range(from,to).abortSignal(signal)))
      .then(rows=>{if(active)setMediaFilenames(Object.fromEntries(rows.map(row=>[row.id,row.image_filenames])));})
      .catch(()=>{if(active)setMediaFilenames({});});
    return()=>{active=false;};
  },[tab,demo,accountId,editor,workspaceReady,editorTask]);
  function openLoadedProperty(property:Property){
    gallery.begin(property,false);
    setNewPropertyId(null);setEditing({...property,images:[...property.images],amenities:[...property.amenities]});setError("");
  }
  function newListing() {
    const property={...emptyProperty(),author_id:defaultListingAuthorId(content.authors||[],user?.id)};
    gallery.begin(property,true);setNewPropertyId(property.id);setEditing(property);setError("");
  }
  function closeListing() {
    if(busy||photoTransfer)return;
    if(editing&&gallery.hasChanges(editing)&&gallery.unavailable&&!window.confirm(site.t(
      "Recovery protection couldn’t be confirmed. Close the editor anyway?","Chưa xác nhận được bảo vệ phiên khôi phục. Vẫn đóng trình chỉnh sửa?")))return;
    setEditing(null);
  }
  async function resumeGallery(checkpoint:GalleryCheckpoint) {
    if(busy||editing||detailFlight.current||!accountId)return;
    const actor=accountId,controller=new AbortController();
    detailFlight.current=controller;setOpeningProperty(checkpoint.listingId);setError("");
    try {
      const recovered=await editorTask(async(db,signal)=>{
        const abort=AbortSignal.any([signal,controller.signal]);
        const latest=await db.from("properties").select("*").eq("id",checkpoint.listingId).abortSignal(abort).maybeSingle();
        if(latest.error)throw latest.error;
        const saved=latest.data as Property|null;
        if(!canResumeGallery(checkpoint,saved))return null;
        const storage=db.storage.from(PROPERTY_IMAGE_BUCKET);
        const draft={...checkpoint.gallery,images:[...checkpoint.gallery.images]};
        const pending=[];
        for(const photo of checkpoint.pending){
          if(draft.images.length>=40){pending.push(photo);continue;}
          abort.throwIfAborted();
          const url=storage.getPublicUrl(photo.path).data.publicUrl;
          if(url!==photo.url||propertyPhotoPath(url)!==photo.path){pending.push(photo);continue;}
          if(draft.images.includes(url))continue;
          const {data,error}=await storage.info(photo.path);
          if(error||!data||!matchesPlannedPhoto(photo,data)){pending.push(photo);continue;}
          draft.images.push(url);
          draft.image_filenames=addImageFilename(draft.image_filenames,url,photo.filename);
        }
        return {saved,draft,pending};
      });
      if(actor!==currentAccount.current||controller.signal.aborted)return;
      if(!recovered){
        setError(site.t("The saved listing changed. Your earlier media edits are still available for review.","Tin đăng đã thay đổi. Các chỉnh sửa tệp trước vẫn còn để kiểm tra."));
        return;
      }
      const base=recovered.saved??{...emptyProperty(),id:checkpoint.listingId,title_en:checkpoint.title,
        author_id:defaultListingAuthorId(content.authors||[],actor)};
      gallery.begin(base,!recovered.saved,{...checkpoint,gallery:recovered.draft,pending:recovered.pending});
      setNewPropertyId(recovered.saved?null:base.id);setEditing({...base,...recovered.draft});
      if(recovered.pending.length)setError(site.t("Some uploads are still unconfirmed. Reconnect or select those original files again. Confirmed photos are in the gallery.","Một số ảnh tải lên chưa được xác nhận. Hãy kết nối lại hoặc chọn lại tệp gốc. Các ảnh đã xác nhận có trong bộ ảnh."));
    } catch {
      if(actor===currentAccount.current&&!controller.signal.aborted)setError(site.t("Couldn’t check the saved listing or uploads. Reconnect and try recovery again.","Không thể kiểm tra tin đăng hoặc ảnh tải lên. Hãy kết nối lại rồi thử khôi phục."));
    } finally {
      if(detailFlight.current===controller){detailFlight.current=null;setOpeningProperty(null);}
    }
  }
  async function openProperty(property:Property){
    if(demo){openLoadedProperty(property);return;}
    if(detailFlight.current||busy)return;
    const controller=new AbortController(),actor=accountId;
    detailFlight.current=controller;setOpeningProperty(property.id);setError("");
    try{
      const {data,error}=await editorTask((db,signal)=>db.from("properties").select("*").eq("id",property.id)
        .abortSignal(AbortSignal.any([signal,controller.signal])).single());
      if(error||!data)throw error??new Error("Listing detail unavailable");
      if(!controller.signal.aborted&&actor===currentAccount.current){
        openLoadedProperty(contentAssets({...content,properties:[data]}).properties[0]);
      }
    }catch{
      if(!controller.signal.aborted&&actor===currentAccount.current)setError(site.t("Couldn’t open this listing. Refresh the workspace and try again.","Không thể mở tin đăng này. Làm mới không gian làm việc rồi thử lại."));
    }finally{
      if(detailFlight.current===controller){detailFlight.current=null;setOpeningProperty(null);}
    }
  }
  useEffect(()=>{
    if(!editor || !client)return;
    let cancelled=false;
    queueMicrotask(()=>{
      if(cancelled)return;
      setRefreshing(true);setWorkspaceLoadFailed(false);
      void refresh().catch(error=>{
        if(!cancelled){setWorkspaceLoadFailed(true);setError(error instanceof Error?error.message:String(error));}
      }).finally(()=>{if(!cancelled)setRefreshing(false);});
    });
    return()=>{cancelled=true;};
  },[accountId,editor,client,refresh]);
  useLayoutEffect(()=>{
    // Clear private workspace state before a different account can paint it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPendingDelete(null);setDeleteError("");setBusy(false);setPhotoTransfer(false);setOpeningProperty(null);setMediaFilenames({});setError("");reading.current.clear();if(accountId){if(lastAccount.current && lastAccount.current!==accountId){setEditing(null);setNewPropertyId(null);setArea(null);setLead(null);setSettingsDraft(null);setTeamDraft(emptyTeamDraft());setCustomerDraft(null);setError("");}lastAccount.current=accountId;}},[accountId]);
  function discardStaffDrafts(){
    setEditing(null);setNewPropertyId(null);setArea(null);setLead(null);setSettingsDraft(null);setTeamDraft(emptyTeamDraft());setCustomerDraft(null);
  }
  async function signOut(){
    if(!client)return;
    setAuthBusy(true);setError("");
    try{await site.signOutSession();discardStaffDrafts();}
    catch(e){setError(e instanceof Error?e.message:"Couldn’t sign out.");}
    finally{setAuthBusy(false);}
  }
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(e.key==="Escape"){setArea(null);setLead(null);}};window.addEventListener("keydown",handler);return ()=>window.removeEventListener("keydown",handler);},[]);
  useEffect(()=>{
    if(!editing||!(busy||photoTransfer||gallery.unavailable))return;
    const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",protect);
    return ()=>window.removeEventListener("beforeunload",protect);
  },[editing,busy,photoTransfer,gallery.unavailable]);
  async function signIn(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(!ready||!client)return;setAuthBusy(true);setError("");const form=new FormData(e.currentTarget);
    try {
      if(resetMode){const {error}=await request(()=>client.auth.resetPasswordForEmail(String(form.get("email")||"").trim().toLowerCase(),{redirectTo:window.location.origin+"/auth/reset"}));if(error)throw error;notice(text("If the account exists, a password reset link has been requested."));}
      else{const {error}=await request(()=>client.auth.signInWithPassword({email:String(form.get("email")||"").trim().toLowerCase(),password:String(form.get("password"))}));if(error)throw error;}
    }catch(e){const issue=e as {code?:string;message?:string};setError(issue?.code==="invalid_credentials"||issue?.message==="Invalid login credentials"?"The email or password is incorrect. Use the password you chose or request a reset link.":e instanceof Error?e.message:"Couldn’t sign in.");}finally{setAuthBusy(false);}
  }
  async function saveProperty(p:Property) {
    if(propertySaveFlight.current||photoTransfer)return;
    if(gallery.hasPending(p)&&!window.confirm(site.t("Some uploads are unconfirmed. Save the completed gallery and keep the other uploads available for recovery?","Một số ảnh tải lên chưa được xác nhận. Lưu ảnh đã hoàn tất và giữ các ảnh còn lại để khôi phục?")))return;
    propertySaveFlight.current=true;
    const actor=accountId;
    setBusy(true);setError("");try{
      if(!p.title_en.trim()||!p.title_vi.trim()||!p.address.trim())throw new Error("Enter both property titles and the public location / street.");
      const isNew=newPropertyId===p.id,automaticUrl=isListingUrlAutomatic(isNew,content.properties.find(row=>row.id===p.id));
      const slug=automaticUrl?generateListingSlug(p,content.properties):p.slug;
      if(!/^([a-z0-9]+-)*[a-z0-9]+$/.test(slug))throw new Error("This listing’s saved link could not be read. Reopen the listing and try again.");
      if(!automaticUrl&&content.properties.some(x=>x.slug===slug&&x.id!==p.id))throw new Error("That listing URL is already used by another property.");
      if(p.status==="published" && !p.images.length)throw new Error("Add at least one original photo before publishing.");
      if(p.listing_type!=="rent")throw new Error("This website publishes rentals only.");
      const priceError=propertyPriceError(p);if(priceError)throw new Error(text(priceError));
      const mapAddress=p.map_address?.trim()||null;
      if(mapAddress&&mapAddress.length>300)throw new Error("Keep the exact map location within 300 characters.");
      const videoError=propertyVideoUrlError(p.video_url);if(videoError)throw new Error(videoError);
      const idError=listingIdError(p.listing_code,isNew);if(idError)throw new Error(idError);
      const code=normalizeListingId(p.listing_code||"")||undefined;
      if(code&&content.properties.some(row=>row.id!==p.id&&normalizeListingId(row.listing_code||"")===code))throw new Error("That listing ID is already in use. Choose another ID.");
      const resolvedAuthor=await resolveListingAuthor({authorId:p.author_id,authors:content.authors||[],user,staffProfile:site.staffProfile,demo,editorTask});
      if(resolvedAuthor.author){const author=resolvedAuthor.author;setContent(previous=>({...previous,authors:(previous.authors||[]).some(row=>row.id===author.id)?previous.authors!.map(row=>row.id===author.id?author:row):[...(previous.authors||[]),author]}));}
      let record={...p,slug,image_filenames:pruneImageFilenames(p.images,p.image_filenames),
        ...(p.image_metadata?{image_metadata:pruneImageMetadata(p.images,p.image_metadata)}:{}),video_url:p.video_url||null,author_id:resolvedAuthor.authorId,map_address:mapAddress,listing_code:code,updated_at:new Date().toISOString(),seo_features:(p.seo_features||[]).filter(value=>p.amenities.includes(value))};
      if(!demo){
        let attempted:Property|undefined;
        let checked=false;
        let latest:Property|null=null;
        async function checkSavedListing() {
          if(checked||actor!==currentAccount.current)return latest;
          checked=true;
          try {
            const result=await editorTask((db,signal)=>db.from("properties").select("*").eq("id",p.id).abortSignal(signal).maybeSingle());
            if(!result.error)latest=result.data;
          }catch{/* Recovery remains available when the confirmation read fails. */}
          return latest;
        }
        const unconfirmed=()=>new Error(site.t("The save could not be confirmed. Reconnect and check the saved listing before trying again. Your gallery and edits are still open.","Chưa thể xác nhận đã lưu. Hãy kết nối và kiểm tra tin đăng trước khi thử lại. Bộ ảnh và nội dung sửa vẫn còn đang mở."));
        const result=await editorTask(async(db,signal)=>{
        const reserved:string[]=[];let candidate=record.slug;
        for(let attempt=0;attempt<20;attempt++){
          signal.throwIfAborted();
          if(automaticUrl){
            const available=await db.from("properties").select("id").eq("slug",candidate).limit(1).abortSignal(signal).maybeSingle();
            if(available.error)throw new Error("Couldn’t check the listing link. Reconnect and save again. Your draft is still open.");
            if(available.data&&available.data.id!==p.id){reserved.push(candidate);candidate=generateListingSlug(p,content.properties,reserved);continue;}
          }
          const submitted={...record,slug:candidate};
          attempted=submitted;
          const saved=await (isNew?db.from("properties").insert(submitted):db.from("properties").update(submitted).eq("id",p.id).eq("updated_at",p.updated_at)).select("*").abortSignal(signal).single();
          if(automaticUrl&&saved.error?.code==="23505"&&/slug/.test((saved.error.message||"")+" "+(saved.error.details||""))){reserved.push(candidate);candidate=generateListingSlug(p,content.properties,reserved);continue;}
          return {...saved,submitted};
        }
        throw new Error("Couldn’t assign a unique listing link. Save again. Your draft is still open.");
        }).catch(async issue=>{
          if(!attempted||actor!==currentAccount.current)throw issue;
          const saved=await checkSavedListing();
          if(saved&&confirmedListingWrite(attempted,saved,isNew?null:p.updated_at))return {data:saved,error:null,submitted:attempted,status:200};
          throw unconfirmed();
        });
        let {error,data}=result;const {submitted}=result;
        if(!data&&(result.status===0||result.status>=500||error?.code==="PGRST116"||error?.code==="23505"||isConflictResponse(error))){
          const saved=await checkSavedListing();
          if(saved&&confirmedListingWrite(submitted,saved,isNew?null:p.updated_at)){data=saved;error=null;}
          else if(result.status===0||result.status>=500)throw unconfirmed();
          else if(error?.code==="PGRST116"||isConflictResponse(error)){
            if(saved)setContent(current=>({...current,properties:current.properties.map(row=>row.id===p.id&&Date.parse(row.updated_at)<=Date.parse(saved.updated_at)?saved:row)}));
            throw new Error(site.t("This listing changed or no longer exists. Review the saved listing before retrying. Your unsaved gallery and edits are still open.","Tin đăng đã thay đổi hoặc không còn tồn tại. Kiểm tra tin đã lưu trước khi thử lại. Bộ ảnh và nội dung sửa vẫn còn đang mở."));
          }
        }
      if((error?.code==="PGRST204"||error?.code==="42703")&&/\bimage_metadata\b/.test(error.message||""))
        throw new Error(site.t("Ask the database administrator to apply the photo metadata migration, then save again. Your edits are still open.", "Hãy nhờ quản trị viên áp dụng bản cập nhật dữ liệu ảnh, rồi bấm lưu lại. Nội dung đang sửa vẫn được giữ."));
      if(error)throw new Error(error.code==="23505"&&/listing_code|listing ID/.test(error.message||"")?"That listing ID is already in use. Choose another ID.":error.message||"Couldn’t save property.");
      if(data?.id!==p.id)throw new Error(site.t("The listing save could not be confirmed. Your edits are still open.", "Chưa thể xác nhận đã lưu tin đăng. Nội dung đang sửa vẫn được giữ."));
      if(data.status!==submitted.status||!sameJson(listingGallery(submitted),listingGallery(data)))throw new Error(site.t(
        "The saved gallery or status differs from this draft. Review the saved listing before retrying. Your edits are still open.",
        "Bộ ảnh hoặc trạng thái đã lưu khác với bản nháp. Kiểm tra tin đã lưu trước khi thử lại. Nội dung đang sửa vẫn còn mở."));
      record={...submitted,...data};
      }
      else record={...record,listing_code:code||previewListingId(content.properties)};
      if(actor!==currentAccount.current)return;
      gallery.confirm(p,record);
      setNewPropertyId(previous=>previous===p.id?null:previous);setContent(previous=>({...previous,properties:previous.properties.some(x=>x.id===p.id)?previous.properties.map(x=>x.id===p.id?record:x):[...previous.properties,record]}));setEditing(previous=>previous===p?null:previous?.id===p.id?{...previous,updated_at:record.updated_at,slug:previous.slug===p.slug?record.slug:previous.slug,author_id:previous.author_id===p.author_id?record.author_id:previous.author_id,listing_code:previous.listing_code===p.listing_code?record.listing_code:previous.listing_code}:previous);notice(demo ? text("Property saved in this browser’s CMS preview.") : record.status === "published"
        ? site.t("Published listing saved.", "Đã lưu tin đăng đã xuất bản.")
        : record.status === "archived" ? site.t("Listing archived.", "Đã lưu trữ tin đăng.") : site.t("Listing draft saved.", "Đã lưu bản nháp tin đăng."));
    }catch(e){if(actor===currentAccount.current)setError(e instanceof Error?e.message:"Couldn’t save property.");}finally{propertySaveFlight.current=false;if(actor===currentAccount.current)setBusy(false);}
  }
  function photoRequest<T>(payload:Record<string,unknown>) {
    return editorTask(async (db,signal)=>{
      const {data}=await db.auth.getSession();
      if(!data.session?.access_token)throw new Error("session_expired");
      const response=await fetch("/api/admin/property-photos",{
        method:"POST",signal,headers:{"Content-Type":"application/json",Authorization:`Bearer ${data.session.access_token}`},
        body:JSON.stringify(payload),
      });
      const result:unknown=await response.json().catch(()=>null);
      if(!response.ok||!result){
        const code=result&&typeof result==="object"&&"error" in result&&typeof result.error==="string"?result.error:"unavailable";
        throw new Error(code);
      }
      return result as T;
    },50000);
  }
  async function renamePhoto(property:Property,source:string,filename:string) {
    if(busy)throw new Error("unavailable");
    const savedBefore=content.properties.find(p=>p.id===property.id);
    setBusy(true);setError("");
    try{
      const result=await photoRequest<RenamePhotoResult>({
        action:"rename",propertyId:property.id,source,filename,version:property.updated_at,cleanupConfirmed:true,
      });
      const origin=new URL(result.url).origin;
      const replace=(url:string)=>replacePropertyPhotoUrl(url,origin,result.oldKey,result.url);
      const apply=(p:Property)=>{
        if(p.id===result.savedListing.id)return result.savedListing;
        const version=result.properties.find(row=>row.id===p.id);
        if(!version)return p;
        return {...remapListingPhotos(p,replace),updated_at:p.updated_at===version.previous_updated_at?version.updated_at:p.updated_at};
      };
      setContent(previous=>({...previous,properties:previous.properties.map(apply),
        settings:{...previous.settings,hero_image:replace(previous.settings.hero_image)},
        neighbourhoods:previous.neighbourhoods.map(row=>({...row,image:replace(row.image)})),
        authors:previous.authors?.map(row=>({...row,portrait_url:replace(row.portrait_url)})),
        activities:previous.activities?.map(row=>({...row,image_url:replace(row.image_url),source_url:replace(row.source_url)})),
        editorial:previous.editorial?.map(row=>({...row,image_url:replace(row.image_url),sources:row.sources?.map(item=>({...item,url:replace(item.url)}))||[]}))}));
      const syncDraft=(draft:Property)=>syncRenamedListingDraft(draft,savedBefore,result,replace);
      setEditing(previous=>previous?.id===property.id?syncDraft(previous):previous);
      if(result.cleanup.status==="removed")notice(site.t("Photo renamed and old Storage copy removed.","Đã đổi tên ảnh và xóa bản cũ khỏi kho lưu trữ."));
      else if(result.cleanup.status==="trashed")notice(site.t("Photo renamed. The old file can be restored for 48 hours.","Đã đổi tên ảnh. Có thể khôi phục tệp cũ trong 48 giờ."));
      else if(result.cleanup.reason==="review_required")notice(site.t("Photo renamed. The old copy is retained for review.","Đã đổi tên ảnh. Bản cũ được giữ lại để kiểm tra."),"warning");
      else notice(site.t("Photo renamed. Removal is pending. Open Rename history to retry.","Đã đổi tên ảnh. Chưa xác nhận đã xóa bản cũ. Mở lịch sử đổi tên để thử lại."),"warning");
      if(syncDraft(property).updated_at!==result.savedListing.updated_at)
        setError(site.t("The saved listing also changed. Review your open edits against the saved version before saving.","Tin đăng đã lưu cũng thay đổi. Hãy đối chiếu các chỉnh sửa đang mở với bản đã lưu trước khi lưu."));
      return result.selectedUrl;
    }finally{setBusy(false);}
  }
  function photoRenameControls(property:Property):PhotoRenameControls|undefined {
    if(demo||newPropertyId===property.id||!canRenamePropertyPhotos(site.staffRole))return undefined;
    return {
      savedImages:content.properties.find(p=>p.id===property.id)?.images||[],
      run:(source,filename)=>renamePhoto(property,source,filename),
      history:async()=>(await photoRequest<{history:PhotoRenameHistory[]}>({action:"history",propertyId:property.id})).history,
      retire:id=>photoRequest<{removed:boolean;expiresAt?:string}>({action:"retire",id,confirm:true}),
    };
  }
  async function saveArea(n:Neighbourhood) {
    setBusy(true);setError("");try{
      if(newArea && content.neighbourhoods.some(x=>x.slug===n.slug))throw new Error("That neighbourhood URL already exists.");
      if(!n.name.trim()||!n.description_en.trim()||!n.description_vi.trim()||!n.image||!/^([a-z0-9]+-)*[a-z0-9]+$/.test(n.slug))throw new Error("Enter the neighbourhood name, a valid URL, an image, and both descriptions.");
      if(!demo){const {error}=await editorTask((db,signal)=>db.from("neighbourhoods").upsert(n).select("slug").abortSignal(signal).single());if(error)throw error;}
      setContent(previous=>({...previous,neighbourhoods:previous.neighbourhoods.some(x=>x.slug===n.slug)?previous.neighbourhoods.map(x=>x.slug===n.slug?n:x):[...previous.neighbourhoods,n]}));setArea(previous=>previous===n?null:previous);notice(demo?text("Neighbourhood saved in this browser."):text("Neighbourhood updated."));
    }catch(e){setError(e instanceof Error?e.message:"Couldn’t save neighbourhood.");}finally{setBusy(false);}
  }
  async function saveLead(e:Enquiry) {
    setBusy(true);setError("");try{
      if(e.status==="scheduled"&&!e.appointment_at)throw new Error("Choose a confirmed viewing time before scheduling.");
      if(!demo){const {error}=await editorTask((db,signal)=>db.rpc("save_customer_enquiry",{enquiry_id:e.id,new_status:e.status,internal_notes:e.notes,scheduled_at:e.appointment_at||null,public_update:e.customer_update||""}).abortSignal(signal));if(error)throw error;}
      setEnquiries(previous=>previous.map(x=>x.id===e.id?e:x));setLead(previous=>previous===e?null:previous);notice(text("Enquiry updated."));
    }catch(e){setError(e instanceof Error?e.message:"Couldn’t update enquiry.");}finally{setBusy(false);}
  }
  function openLead(enquiry:Enquiry){
    setLead({...enquiry});setError("");if(enquiry.read_at||reading.current.has(enquiry.id))return;
    const actor=user?.id;reading.current.add(enquiry.id);
    const mark=async()=>{
      let state:Pick<Enquiry,"read_at"|"read_by"|"property_code"|"property_address">;
      if(demo)state={read_at:new Date().toISOString(),read_by:null};
      else{const {data,error}=await editorTask((db,signal)=>db.rpc("mark_enquiry_read",{target_enquiry:enquiry.id}).abortSignal(signal));if(error||!data||typeof data.read_at!=="string")throw error||new Error("Read was not confirmed");state=data;}
      if(!demo&&currentAccount.current!==actor)return;
      setEnquiries(rows=>rows.map(row=>row.id===enquiry.id?{...row,...state}:row));
      setLead(current=>current?.id===enquiry.id?{...current,...state}:current);
    };
    void mark().catch(()=>{if(demo||currentAccount.current===actor)notice(text("Couldn’t mark this enquiry as read. Reopen it to try again."), "error");}).finally(()=>reading.current.delete(enquiry.id));
  }
  async function removeRecord(){
    if(!pendingDelete||busy||!canDeleteContent(site.staffRole))return;
    const target=pendingDelete,actor=user?.id,property=content.properties.find(item=>item.id===target.id);
    setBusy(true);setDeleteError("");
    try{
      let deletion: ListingDeletion | undefined;
      if(target.kind==="property"){
        deletion=await listingDeletionRequest<ListingDeletion>(editorTask,{action:"delete",confirm:true,propertyId:target.id,version:target.version});
      }else{
        const {error,data}=await editorTask((db,signal)=>db.rpc("delete_enquiry",{target_enquiry:target.id}).abortSignal(signal));
        if(error||data!==true)throw error||new Error("Deletion was not confirmed");
      }
      if(currentAccount.current!==actor)return;
      if(target.kind==="property"){
        setContent(previous=>{const properties=previous.properties.filter(item=>item.id!==target.id),valid=new Set(properties.filter(isPublicRental).map(item=>item.id));return {...previous,properties,propertyOrders:Object.fromEntries(Object.entries(previous.propertyOrders||{}).map(([scope,ids])=>[scope,ids?.includes(target.id)?ids.filter(id=>valid.has(id)):ids]))};});
        setEnquiries(rows=>rows.map(row=>row.property_id===target.id?{...row,property_id:null,property_code:row.property_code||property?.listing_code||"",property_address:row.property_address||property?.address||""}:row));
        if(site.savedReady&&site.saved.includes(target.id)&&!site.pendingSaved.includes(target.id))site.toggleSaved(target.id);
        setEditing(current=>current?.id===target.id?null:current);
        setLatestDeletion(deletion||null);
        if(deletion?.pending||deletion?.review)notice(site.t("Listing deleted. Eligible files have a 48-hour restore window.","Đã xóa tin đăng. Các tệp đủ điều kiện có thể được khôi phục trong 48 giờ."),"warning");
        else notice(site.t(`Listing deleted. ${deletion?.removed||0} files removed, ${deletion?.retained||0} retained.`, `Đã xóa tin đăng. Đã xóa ${deletion?.removed||0} tệp, giữ lại ${deletion?.retained||0} tệp.`));
      }else{setEnquiries(rows=>rows.filter(row=>row.id!==target.id));setLead(current=>current?.id===target.id?null:current);notice(text("Enquiry deleted."));}
      setPendingDelete(null);void refresh().catch(()=>{});
    }catch(error){if(currentAccount.current===actor)setDeleteError(target.kind==="property"?listingDeletionMessage(error,site.t):text("Couldn’t confirm deletion. Refresh the data before trying again."));}
    finally{if(currentAccount.current===actor)setBusy(false);}
  }
  async function saveSettings(next:Settings) {
    setBusy(true);setError("");try{
      if(!demo){const {error}=await editorTask((db,signal)=>db.from("site_settings").upsert(next).select("id").abortSignal(signal).single());if(error)throw error;}
      setContent(previous=>({...previous,settings:next}));setSettingsDraft(previous=>previous===next?null:previous);notice(demo?text("Site settings saved in this browser."):text("Site settings updated."));
    }catch(e){setError(e instanceof Error?e.message:"Couldn’t save settings.");}finally{setBusy(false);}
  }
  async function upload(file:File,options:PropertyImageUploadOptions={}):Promise<string> {
    try {
      if(demo){
        if(file.size>2*1024*1024)throw new Error("CMS preview uploads must be under 2 MB for browser storage.");
        const prepared=await preparePropertyImage(file);
        return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Couldn’t read image."));reader.readAsDataURL(prepared.body);});
      }
      if(!client)throw new Error("Connect Supabase before uploading.");
      const url=await editorTask((db,signal)=>uploadPropertyImage(db,file,options.signal?AbortSignal.any([signal,options.signal]):signal,{...options,expectedUserId:user?.id}),null);
      if(!options.listingId)notice(site.t("Image uploaded.", "Đã tải ảnh lên."));
      return url;
    } catch(error) { throw new Error(imageUploadError(error, language)); }
  }

  const authConnectionLabel=site.t("Connecting to sign-in…", "Đang kết nối để đăng nhập…");
  if(!demo&&configured&&!site.sessionResolved)return <SessionGate label={site.t("Checking staff access…", "Đang kiểm tra quyền truy cập nhân viên…")}
    connectionLabel={authConnectionLabel}/>;
  if(!demo && !(user&&editor))return <div className="admin-auth"><div className="admin-auth-intro"><div className="admin-auth-header"><BackNavigation/><Brand light href={publicHome}/><LanguageSwitcher light/></div><div><h1>{text("Staff portal.")}</h1><p>{text("For the Gary Home team: manage listings, customers, viewings and site content.")}</p></div><Link href={publicHome}><ArrowLeft size={16}/>{text("Back to the website")}</Link></div><div className="admin-login"><PortalSwitcher active="staff"/><div className="eyebrow">{text("STAFF ACCESS · ASSIGNED ACCOUNTS")}</div><h2>{configured?resetMode?text("Reset staff password."):text("Staff sign in."):site.seedPreview?text("Your workspace is ready."):text("Staff sign-in is temporarily unavailable.")}</h2>{configured?<><p>{user?(sessionPhase!=="ready"?text("We’re checking your editor access. Reconnect if this does not finish."):text("Signed in as {email}. Studio requires an account assigned by a higher-level team member.",{email:user.email||""})):resetMode?text("Enter your team email to request a password reset."):text("Use your assigned company or Gmail address. Staff access must be granted by a higher-level team member.")}</p>{!user?<form onSubmit={signIn} className="enquiry-form" aria-label={text("Staff account access")}><label>{text("Staff email / owner account")}<input name="email" type="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" placeholder="you@garyhome.com" required/></label>{!resetMode&&<label>{text("Password")}<PasswordInput inputProps={{"name":"password","required":true,"autoComplete":"current-password"}}/></label>}{error&&<div className="form-error" role="alert">{text(error)}</div>}<button className="button" disabled={authBusy||!ready||!client}>{authBusy?text("Please wait…"):resetMode?text("Request reset link"):text("Sign in as staff")}<ArrowRight size={17}/></button>{!ready?<DelayedLattice operation="authentication" label={authConnectionLabel}/>:!client?<div className="form-error" role="alert">{site.t("Sign-in could not connect.", "Không thể kết nối để đăng nhập.")} <button type="button" className="text-link" onClick={()=>void reconnect()}>{text("Reconnect")}</button></div>:null}<button type="button" className="text-link" onClick={()=>{setResetMode(!resetMode);setError("");}}>{resetMode?text("Back to sign in"):text("Forgot your password?")}</button></form>:<div className="staff-account-choice"><Link href={CUSTOMER_ACCOUNT_URL} className="button button-outline">{text("Open customer portal")}<ArrowUpRight size={16}/></Link><button className="text-link" disabled={authBusy} onClick={()=>void signOut()}>{text("Sign out and use a staff account")}</button></div>}</>:site.seedPreview?<><p>{text("The CMS is built and ready for your Supabase project. Explore its working browser preview while the account connection is being completed.")}</p><div className="admin-preview-explainer"><Check size={16}/>{text("Create and edit property listings")}<br/><Check size={16}/>{text("Manage photos, neighbourhoods, and site content")}<br/><Check size={16}/>{text("Review preview viewing requests")}</div><button className="button" onClick={enterDemo}>{text("Explore the CMS preview")}<ArrowRight size={17}/></button><p className="small muted">{text("Preview edits are saved only in this browser. Live sign-in, uploads, and shared data become available once Supabase is connected.")}</p></>:<p className="form-error" role="status">{text("Staff sign-in is temporarily unavailable.")}</p>}<p className="staff-login-password-help">{text("Sign in with the password you chose after verifying your email. Your Home role is granted separately by a higher-level team member.")}</p><div className="staff-access-note"><ShieldCheck size={17}/><p>{text("Staff accounts are created or assigned by a higher-level team member. Contact your team manager to request access.")}</p></div><Link href={CUSTOMER_ACCOUNT_URL} className="portal-other-link"><Users size={19}/><span><strong>{text("Looking for a home?")}</strong><small>{text("Customer sign in and registration")}</small></span><ArrowUpRight size={17}/></Link></div></div>;
  function refreshWorkspace(){
    if(refreshing)return;
    const requestingUser=user?.id;
    setRefreshing(true);setError("");setWorkspaceLoadFailed(false);
    void refresh().catch(error=>{
      if(currentAccount.current===requestingUser){setWorkspaceLoadFailed(true);setError(error instanceof Error?error.message:String(error));}
    }).finally(()=>{if(currentAccount.current===requestingUser)setRefreshing(false);});
  }
  const filtered=filterStudioListings(content.properties,{query,status,priceSort,priceMin,priceMax,currency:site.currency,exchangeRate:site.exchangeRate,text:p=>`${listingCode(p)} ${p.title_en} ${p.title_vi} ${p.address}`});
  const live=content.properties.filter(p=>p.status==="published").length;const draft=content.properties.filter(p=>p.status==="draft").length;const newLeads=enquiries.filter(e=>!e.read_at).length;
  const connectionLabel=demo?"Browser preview":sessionPhase==="offline"?"Offline":sessionPhase==="recovering"?"Reconnecting…":sessionPhase==="error"?"Connection needs attention":"Connected to Supabase";
  const listingTitle=editing&&(language==="vi"?[editing.title_vi,editing.title_en]:[editing.title_en,editing.title_vi]).find(title=>title.trim());
  const connection=<span className={`admin-connection ${demo||sessionPhase!=="ready"?"demo":""}`} title={text(connectionLabel)}>
    <span className="live-dot"/><span className="connection-label">{text(connectionLabel)}</span>
  </span>;
  return <StudioShell text={text} sidebar={({closeNavigation,compact,mobile})=><>
    <Brand href={publicHome} compact={compact}/><span className="studio-label">{text("STAFF PORTAL")}</span>
    <BranchedMenu items={sidebarItems} active={tab==="media"?"properties":tab} label={text("CMS navigation")} onSelect={value=>{if(visibleTabs.some(([id])=>id===value)){setTab(value as Tab);setError("");closeNavigation();}}}/>
    <div className="admin-sidebar-bottom">
      {demo ? <div><span className="avatar">G</span><span className="admin-sidebar-identity"><strong>{text("Preview workspace")}</strong><small>{text("Saved on this device")}</small></span><button className="icon-button admin-sidebar-signout" type="button" aria-label={text("Exit preview")} data-tooltip={text("Exit preview")} onClick={exitDemo}><LogOut size={20}/></button></div>
        : <StaffAccountMenu key={user?.id} onDashboard={()=>{setTab("overview");setError("");closeNavigation();}} onSignedOut={discardStaffDrafts} profileHost={staffProfileHost} mobile={mobile}/>}
    </div>
  </>}>{({trigger,open,mobile})=><>
    <div className="admin-main" inert={open}>
      <header className="admin-topbar">
        {trigger}{!mobile&&<BackNavigation/>}
        <div className="admin-breadcrumb"><span>{text("Staff workspace")}</span><ChevronRight size={13}/><strong>{text(tabs.find(([id])=>id===(tab==="media"?"properties":tab))?.[1]||"")}</strong></div>
        <div className="admin-topbar-actions">
          <ServiceAppsMenu className="gary-apps-menu--studio"/>
          {demo?<>{connection}<SitePreferences studio/></>:<StudioNotifications key={user?.id+"-"+site.staffRole} embedded={mobile} navigate={category=>{
            if(category==="profile"){window.dispatchEvent(new Event("gary-open-staff-profile"));return;}
            setTab(category==="landlord"?"landlords":category==="enquiry"?"enquiries":category==="feedback"?"feedback":category==="commission"?"assistance":canViewTeam(site.staffRole)?"team":"overview");
          }}>{notifications=><>
            {!mobile&&notifications.render()}
            {connection}
            <SitePreferences studio notifications={mobile?notifications:undefined}/>
          </>}</StudioNotifications>}
        </div>
      </header>
      <div className="admin-content">{!demo&&<StaffPasswordReminder/>}<div className="admin-page-heading"><div><div className="eyebrow">{tab==="overview"?text("A LITTLE OVERVIEW"): "GARY HOME STUDIO"}</div><h1>{tab==="overview"?text("Good homes. Well looked after."):text(tabs.find(([id])=>id===(tab==="media"?"properties":tab))?.[1]||"")}</h1><p>{tab==="overview"?text("Here’s what’s happening in your corner of Hanoi."):tab==="properties"?text("From a first draft to someone’s next chapter."):tab==="enquiries"?text("Every good move starts with a conversation."):tab==="customers"?text("Every customer deserves a little care."):tab==="media"?text("Original photos. An honest first impression."):tab==="neighbourhoods"?text("Help people find their kind of Hanoi."):text("The details that make this website yours.")}</p></div>{(tab==="properties"||tab==="media"||tab==="overview")&&<button className="button" disabled={!workspaceReady} onClick={newListing}><Plus size={17}/>{text("Add a property")}</button>}{tab==="neighbourhoods"&&<button className="button" disabled={!workspaceReady} onClick={()=>{setNewArea(true);setArea({slug:"",name:"",tagline_en:"",tagline_vi:"",description_en:"",description_vi:"",image:"",sort_order:content.neighbourhoods.length});setError("");}}><Plus size={17}/>{text("Add neighbourhood")}</button>}</div>{error&&workspaceReady&&<div className="form-error admin-error" role="alert">{text(error)}<button onClick={()=>setError("")} aria-label={text("Dismiss error")}><X size={15}/></button></div>}
  {!workspaceReady ? (
    sessionPhase!=="ready" ? null : workspaceLoadFailed ? <>
      <div className="form-error" role="alert">{site.t("Couldn’t load the staff workspace. Check your connection and try again.", "Chưa thể tải không gian làm việc của nhân viên. Hãy kiểm tra kết nối rồi thử lại.")}</div>
      <button type="button" className="button button-outline button-small" onClick={refreshWorkspace}>{site.t("Retry loading workspace", "Thử tải lại không gian làm việc")}</button>
    </> : <DelayedLattice operation="workspace" skeleton={tab==="overview"?"stats":"rows"} label={site.t("Loading staff workspace…", "Đang tải không gian làm việc…")}/>
  ) : <>
  {tab==="help"&&<PortalHelp key={(user?.id||"demo")+"-"+site.staffRole} portal="staff"/>}
  {tab==="overview"&&<PortalHelpStart open={()=>setTab("help")}/>}<div className="admin-stats" hidden={tab!=="overview"}>{[[Building2,live,"Published properties","Ready to discover"],[FileText,draft,"Draft listings","A little work in progress"],[MessageSquare,newLeads,"Unread enquiries","Conversations waiting"],[ImageIcon,content.properties.reduce((sum,p)=>sum+p.images.length,0),"Property photos","The real picture"]].map(([Icon,value,label,sub],i)=>{const Symbol=Icon as typeof Building2;return <div key={i}><span><Symbol size={21}/></span><strong>{demo||studioDataReady?<Counter value={value as number} fontSize="inherit" motionBlur={false} announce/>:"—"}</strong><h3>{text(label as string)}</h3><p>{text(sub as string)}</p></div>;})}</div>{tab==="overview"&&<div className="admin-overview-grid"><section className="admin-panel"><div className="panel-heading"><h2>{text("The latest conversations")}</h2><button className="text-link" onClick={()=>setTab("enquiries")}>{text("View all")}<ArrowUpRight size={15}/></button></div>{enquiries.length?enquiries.slice(0,5).map(e=><button key={e.id} className="enquiry-row" data-unread={!e.read_at} onClick={()=>openLead(e)}><span className="avatar">{e.name[0]}</span><span><strong>{e.name}</strong><small>{e.message.slice(0,80)}</small><small className="enquiry-read-state">{text(e.read_at?"Read":"Unread")}</small></span><span className={`status-badge status-${e.status}`}>{text(e.status==="new"?"Awaiting response":e.status)}</span><ChevronRight size={16}/></button>):<div className="admin-empty"><MessageSquare size={31}/><h3>{text("A quiet inbox, for now.")}</h3><p>{demo?text("Send a preview request from a property page to see it appear here."):text("Viewing requests and contact messages will appear here.")}</p><a className="text-link" href={`${demo ? "" : CANONICAL_SITE_ORIGIN}${localizedPath("/contact",language)}`} target="_blank" rel="noopener noreferrer">{text("Open contact page")}<ArrowUpRight size={15}/></a></div>}</section><section className="admin-panel getting-started"><div className="eyebrow">{text("MAKE IT YOURS")}</div><h2>{text("A good first impression starts here.")}</h2><p>{text("Keep your listings useful, your photos current, and your conversations moving.")}</p>{[["properties","Add original property photos"],["neighbourhoods","Introduce your neighbourhoods"],["settings","Check your contact details"]].map(([id,label],i)=><button key={id} onClick={()=>setTab(id as Tab)}><span>{i+1}</span>{text(label)}<ArrowUpRight size={16}/></button>)}</section></div>}
  {(tab==="properties"||tab==="media")&&<div className="activity-tabs listing-workspace-tabs" role="group" aria-label={text("Listing workspace")}><button type="button" aria-pressed={tab==="properties"} onClick={()=>setTab("properties")}><Building2 size={16}/>{text("Listings")}</button><button type="button" aria-pressed={tab==="media"} onClick={()=>setTab("media")}><ImageIcon size={16}/>{text("Media library")}</button></div>}
  {!demo&&site.staffRole==="owner"&&<StorageMediaManagement key={user?.id} latest={latestDeletion} visible={tab==="properties"}
    onListingRestored={()=>{void refresh().catch(()=>{});}}/>}
  {tab==="properties"&&!demo&&gallery.entries.length>0&&<section className="admin-panel listing-deletion-queue" aria-label={site.t("Unsaved photo galleries","Bộ ảnh chưa lưu")}>
    <h3>{site.t("Unsaved photo galleries","Bộ ảnh chưa lưu")}</h3>
    {gallery.entries.map(checkpoint=><div key={checkpoint.key} className="storage-media-actions">
      <button type="button" className="button button-outline button-small" disabled={openingProperty!==null||busy}
        onClick={()=>void resumeGallery(checkpoint)}>{site.t("Resume gallery","Tiếp tục bộ ảnh")} · {checkpoint.title||site.t("New listing","Tin đăng mới")}</button>
      <span>{checkpoint.gallery.images.length} {site.t("photos","ảnh")}{checkpoint.pending.length>0&&` · ${checkpoint.pending.length} ${site.t("unconfirmed","chưa xác nhận")}`}</span>
      <button type="button" className="text-link" onClick={()=>void navigator.clipboard.writeText(JSON.stringify(checkpoint,null,2)).then(
        ()=>notice(site.t("Recovery data copied.","Đã sao chép dữ liệu khôi phục.")),
        ()=>setError(site.t("Couldn’t copy the recovery data. The local gallery is still available.","Không thể sao chép dữ liệu khôi phục. Bộ ảnh trên thiết bị vẫn còn.")))}>
        {site.t("Copy recovery data","Sao chép dữ liệu khôi phục")}</button>
      <button type="button" className="text-link" disabled={openingProperty!==null||busy} onClick={()=>{
        if(window.confirm(site.t("Discard this recovery copy and release its media protection?","Bỏ bản khôi phục này và ngừng bảo vệ tệp trong phiên?")))
          void gallery.discard(checkpoint)?.then(confirmed=>{if(!confirmed)setError(site.t("Couldn’t discard the recovery copy. Reconnect and try again.","Chưa bỏ được bản khôi phục. Hãy kết nối lại rồi thử lại."));});
      }}>{site.t("Discard local copy","Bỏ bản trên thiết bị")}</button>
    </div>)}
  </section>}
  {tab==="properties"&&<section className="admin-panel"><div className="admin-table-tools listing-search-tools"><label><Search size={17}/><input placeholder={text("Search an ID, title or address…")} value={query} onChange={e=>setQuery(e.target.value)}/></label></div><div className="admin-table-scroll"><table className="admin-table admin-table--listings"><thead><tr><th>{text("Property")}</th><th>{text("Neighbourhood")}</th><th aria-sort={priceSort==="low"?"ascending":priceSort==="high"?"descending":"none"}><span className="listing-column-label">{text("Price")}<ListingPriceFilter sort={priceSort} min={priceMin} max={priceMax} currency={site.currency} onSort={setPriceSort} onMin={setPriceMin} onMax={setPriceMax} onReset={()=>{setPriceSort("");setPriceMin("");setPriceMax("");}} text={text}/></span></th><th><span className="listing-column-label">{text("Status")}<ListingStatusFilter status={status} onStatus={setStatus} text={text}/></span></th><th>{text("Created")}</th><th>{text("Posted by")}</th><th>{text("Actions")}</th></tr></thead><tbody>{filtered.map(p=>{
    const created=listingCreationTime(posting.records[p.id]?.created_at||p.created_at,language);
    const title=language==="vi"?p.title_vi||p.title_en:p.title_en;
    const href=demo?undefined:publishedListingUrl(p,language);
    const viewLabel=text("View {title}",{title});
    const thumbnail=p.images[0]?<ContentImage src={p.images[0]} alt="" width={120} height={80} sizes="64px" loading="lazy"/>:
      <span className="listing-thumbnail-placeholder" role="img" aria-label={site.t("No listing photos saved", "Chưa lưu ảnh tin đăng")}>
        <ImageIcon size={18} aria-hidden="true"/>
      </span>;
    return <tr key={p.id}><td><div className="admin-property-cell">
      {href?<a className="listing-thumbnail-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={viewLabel}>{thumbnail}</a>:thumbnail}
      <div><strong>{href?<a className="listing-title-link" href={href} target="_blank" rel="noopener noreferrer">{title}</a>:title}</strong><small>{listingCode(p)} · {typeLabel(p.property_type,language)} · {p.bedrooms} {text("beds")} {p.featured?text("· Featured"):""}</small></div></div></td><td>{content.neighbourhoods.find(n=>n.slug===p.district_slug)?.name||p.district_slug}</td><td>{formatPropertyPrice(p,language)??text("On request")}{p.price!==null&&p.price_vnd!=null&&<small>{formatPropertyPrice(p,language,"VND")}</small>}{p.listing_type==="rent"&&(p.price!==null||p.price_vnd!=null)&&<small>{p.price_period==="night"?text("/ night"):p.price_period==="week"?text("/ week"):text("/ month")}</small>}</td><td><span className={`status-badge status-${p.status}`}>{text(p.status)}</span></td><td className="listing-created">{created?<time dateTime={created.iso}><span>{created.date}</span><small>{created.time} GMT+7</small></time>:text("Not recorded")}</td><td className="listing-poster">{posting.records[p.id]?posting.records[p.id].actor_name||text("Recorded staff member"):text("Not recorded")}</td><td><div className="row-actions"><button type="button" data-button-variant="edit" disabled={openingProperty!==null} aria-busy={openingProperty===p.id} onClick={()=>void openProperty(p)}>{text("Edit")}</button>{canDeleteContent(site.staffRole)&&<button data-button-variant="danger" type="button" className="text-danger" aria-label={text("Delete listing")+" · "+listingCode(p)} onClick={()=>{setDeleteError("");setPendingDelete({kind:"property",id:p.id,version:p.updated_at,label:listingCode(p)+" · "+(language==="vi"?p.title_vi:p.title_en)});}}><Trash2 size={14}/>{text("Delete")}</button>}{href&&<a href={href} target="_blank" rel="noopener" aria-label={viewLabel} data-button-variant="view" data-button-size="icon"><ArrowUpRight size={17} aria-hidden="true"/></a>}</div></td></tr>;})}</tbody></table></div>{posting.error&&<p className="form-info" role="status">{posting.error}</p>}{!filtered.length&&<div className="admin-empty"><p>{text("No properties match this search.")}</p></div>}<div className="table-footer">{text("{count} properties",{count:filtered.length})} · {text("Creation times use Hanoi time (GMT+7). Earlier poster identities may not be recorded.")}</div></section>}
  {tab==="enquiries"&&<section className="admin-panel"><div className="panel-heading"><h2>{text("{count} conversations",{count:enquiries.length})}</h2>{!demo&&<button className="text-link" onClick={refreshWorkspace} disabled={refreshing} aria-busy={refreshing}><RefreshCw size={15} className={refreshing?"spin":""}/>{text("Refresh")}</button>}</div>{enquiries.length?enquiries.map(e=><button className="enquiry-row" data-unread={!e.read_at} key={e.id} onClick={()=>openLead(e)}><span className="avatar">{e.name[0]}</span><span><strong>{e.name}<small>{e.email} · {text(e.kind)}</small></strong><small>{e.message.slice(0,120)}</small><small className="enquiry-read-state">{text(e.read_at?"Read":"Unread")}</small></span><time>{new Date(e.created_at).toLocaleDateString(language==="vi"?"vi-VN":"en-US")}</time><span className={`status-badge status-${e.status}`}>{text(e.status==="new"?"Awaiting response":e.status)}</span><ChevronRight size={17}/></button>):<div className="admin-empty"><MessageSquare size={31}/><h3>{text("Your next conversation will appear here.")}</h3><p>{demo?text("Try sending a request from the website’s contact form."):text("You’ll find contact and viewing requests here.")}</p></div>}</section>}
  {tab==="landlords"&&<LandlordManager openListing={openLoadedProperty}/>}
  {(tab==="news"||tab==="tips")&&<EditorialManager key={user?.id||"preview"} kind={tab==="news"?"news":"tip"} upload={upload}/>}
  {tab==="rental-content"&&<RentalContentManager key={user?.id||"preview"} upload={upload}/>}
  {(tab==="feedback"||tab==="assistance")&&<SubmissionManager kind={tab}/>}
  {tab==="team"&&canViewTeam(site.staffRole)&&<TeamManager key={(user?.id||"preview")+"-"+site.staffRole} draft={teamDraft} setDraft={setTeamDraft}/>}
  {tab==="customers"&&<CustomerManager key={user?.id||"preview"} openEnquiry={openLead} draft={customerDraft} setDraft={setCustomerDraft}/>}
  {tab==="neighbourhoods"&&<div className="admin-area-grid">{content.neighbourhoods.map(n=><article className="admin-panel" key={n.slug}><img src={n.image} alt={n.name}/><div><h2>{n.name}</h2><p>{language==="vi"?n.tagline_vi||n.tagline_en:n.tagline_en}</p><button className="button button-outline button-small" onClick={()=>{setNewArea(false);setArea({...n});setError("");}}>{text("Edit neighbourhood")}<ArrowRight size={16}/></button></div></article>)}</div>}
  {tab==="media"&&<><div className="form-info">{site.t("Upload and reorder photos in a property’s editor. The first photo is its cover. JPG, PNG, WebP, and AVIF are supported.", "Tải lên và sắp xếp ảnh trong trình chỉnh sửa tin đăng. Ảnh đầu tiên là ảnh bìa. Hỗ trợ JPG, PNG, WebP và AVIF.")} {demo?site.t("Browser preview limit is 2 MB per file.", "Bản xem trước trên trình duyệt giới hạn 2 MB mỗi tệp."):site.t("Original photos up to 32 MB are optimized before upload.", "Ảnh gốc tối đa 32 MB được tối ưu trước khi tải lên.")}).</div><div className="admin-media-grid">{content.properties.flatMap(p=>p.images.map((src,i)=>({src,p,i}))).map(({src,p,i})=><button key={p.id+"-"+i} disabled={openingProperty!==null} aria-busy={openingProperty===p.id} onClick={()=>void openProperty(p)}><ContentImage src={src} alt={language==="vi"?p.title_vi||p.title_en:p.title_en} width={320} height={210} sizes="(max-width: 650px) 50vw, 240px" loading="lazy"/><span><strong>{language==="vi"?p.title_vi||p.title_en:p.title_en}</strong><small>{i===0?text("Cover photo"):text("Photo {number}",{number:i+1})}</small><small className="media-filename">{imageFilename(src,p.image_filenames??mediaFilenames[p.id])||text("Filename unavailable")}</small></span></button>)}</div></>}
  {tab==="seo"&&<SeoAuditDashboard key={user?.id || "demo"}/>}
  {tab==="settings"&&<SettingsForm settings={settingsDraft||content.settings} onChange={next=>setSettingsDraft(previous=>typeof next==="function"?next(previous||content.settings):next)} onSave={saveSettings} upload={upload} busy={busy}/>}
  </>}
  </div></div>
  <div ref={setStaffProfileHost}/>
  <AnimatePresence initial={false}>{pendingDelete&&canDeleteContent(site.staffRole)&&<DeleteConfirmation title={pendingDelete.kind==="property"?site.t("Permanently delete listing?","Xóa vĩnh viễn tin đăng?"):text("Delete enquiry?")} target={pendingDelete.label} description={pendingDelete.kind==="property"?site.t("This permanently removes the listing and its exclusive media. Direct links to removed files can stop working. Archive it in the editor to hide it while keeping its files. Enquiries and assistance records are preserved.","Thao tác này xóa vĩnh viễn tin đăng và các tệp chỉ thuộc về tin này. Liên kết trực tiếp đến tệp đã xóa có thể ngừng hoạt động. Chuyển sang Lưu trữ trong trình chỉnh sửa để ẩn tin mà vẫn giữ các tệp. Các yêu cầu và hồ sơ hỗ trợ vẫn được giữ.") :text("This permanently deletes the enquiry and its internal notes.")} busy={busy} error={deleteError} onCancel={()=>setPendingDelete(null)} onConfirm={()=>void removeRecord()}/>}</AnimatePresence>
  <AnimatePresence initial={false}>{editing&&<EditorModal closeDisabled={busy||photoTransfer} workspaceKey="property" listingCode={editing.listing_code} resizable title={listingTitle||""} subtitle={text("PROPERTY EDITOR")} close={closeListing}><PropertyEditor key={editing.id} property={editing} isNew={newPropertyId===editing.id} setProperty={next=>setEditing(previous=>previous?.id===editing.id?(typeof next==="function"?next(previous):next):previous)} neighbourhoods={content.neighbourhoods} onSave={saveProperty} onCancel={closeListing} upload={upload} onPlanned={photo=>gallery.plan(editing.id,photo)} onPhotoTransfer={setPhotoTransfer} galleryChanged={gallery.hasChanges(editing)} galleryUnavailable={gallery.unavailable} busy={busy} error={error} renamePhotos={photoRenameControls(editing)}/></EditorModal>}</AnimatePresence>
  <AnimatePresence initial={false}>{area&&<EditorModal closeDisabled={busy} workspaceKey="neighbourhood" title={area.name} subtitle={text("NEIGHBOURHOOD EDITOR")} close={()=>{if(!busy)setArea(null);}}><form className="editor-form" onSubmit={e=>{e.preventDefault();void saveArea(area);}}><PublicUrlField kind="neighbourhood" value={area.slug} disabled={!newArea} onChange={value=>setArea({...area,slug:value})}/><label>{text("Neighbourhood name")}<input value={area.name} onChange={e=>setArea({...area,name:e.target.value})} required/></label><div className="form-row"><label>{text("Tagline · English")}<input value={area.tagline_en} onChange={e=>setArea({...area,tagline_en:e.target.value})}/></label><label>{text("Tagline · Vietnamese")}<input value={area.tagline_vi} onChange={e=>setArea({...area,tagline_vi:e.target.value})}/></label></div><label>{text("Description · English")}<textarea rows={4} value={area.description_en} onChange={e=>setArea({...area,description_en:e.target.value})} required/></label><label>{text("Description · Vietnamese")}<textarea rows={4} value={area.description_vi} onChange={e=>setArea({...area,description_vi:e.target.value})} required/></label><ImageUpload value={area.image} onChange={image=>setArea(previous=>previous?{...previous,image}:previous)} upload={upload}/>{error&&<div className="form-error" role="alert">{text(error)}</div>}<footer className="gw-editor-actions"><button data-button-variant="cancel" type="button" className="button button-outline" disabled={busy} onClick={()=>setArea(null)}>{text("Cancel")}</button><button data-button-variant="save" className="button" disabled={busy}><Save size={17}/>{busy?text("Saving…"):text("Save neighbourhood")}</button></footer></form></EditorModal>}</AnimatePresence>
  <AnimatePresence initial={false}>{lead&&<EditorModal closeDisabled={busy} workspaceKey="enquiry" title={lead.name} subtitle={text(lead.kind)} close={()=>{if(!busy)setLead(null);}}><form className="editor-form" onSubmit={e=>{e.preventDefault();void saveLead(lead);}}><div className="lead-contact"><a href={`mailto:${lead.email}`}><Mail size={16}/>{lead.email}</a>{lead.phone&&<a href={`tel:${lead.phone}`}><Phone size={16}/>{lead.phone}</a>}</div><div className="lead-message">{lead.message}</div><p className="lead-read-state">{text(lead.read_at?"Read":"Unread")}{lead.read_at?" · "+new Date(lead.read_at).toLocaleString(language==="vi"?"vi-VN":"en-GB",{timeZone:"Asia/Ho_Chi_Minh"}):""}</p>{!lead.property_id&&lead.property_code&&<p><strong>{text("Property:")} </strong>{lead.property_code} · {lead.property_address}</p>}{lead.property_id&&<p><strong>{text("Property:")} </strong>{(language==="vi"?content.properties.find(p=>p.id===lead.property_id)?.title_vi:content.properties.find(p=>p.id===lead.property_id)?.title_en)||content.properties.find(p=>p.id===lead.property_id)?.title_en||text("Property no longer listed")}</p>}{lead.preferred_date&&<p><strong>{text("Requested date:")} </strong>{new Date(lead.preferred_date+"T12:00:00").toLocaleDateString(language==="vi"?"vi-VN":"en-US")} <span className="muted">{text("(not yet confirmed)")}</span></p>}<label>{text("Conversation status")}<SelectField value={lead.status} onValueChange={value=>setLead({...lead,status:value as Enquiry["status"]})}><option value="new">{text("New")}</option><option value="contacted">{text("Contacted")}</option><option value="scheduled" disabled={lead.kind!=="viewing"}>{text("Viewing scheduled")}</option><option value="closed">{text("Closed")}</option></SelectField></label>{lead.cancelled_at&&<div className="form-info">{text("The customer cancelled this viewing request.")}</div>}{(lead.kind==="viewing"||lead.status==="scheduled")&&<label>{text("Confirmed viewing time · Hanoi (GMT+7)")}<input type="datetime-local" value={hanoiInput(lead.appointment_at)} onChange={e=>setLead({...lead,appointment_at:e.target.value?new Date(e.target.value+"+07:00").toISOString():null})}/></label>}<label>{text("Update for the customer")}<textarea rows={3} value={lead.customer_update||""} onChange={e=>setLead({...lead,customer_update:e.target.value})} maxLength={2000}/><small>{text("Visible in the customer’s account. Keep internal details in the notes below.")}</small></label><label>{text("Internal notes")}<textarea rows={5} value={lead.notes} onChange={e=>setLead({...lead,notes:e.target.value})} maxLength={8000} placeholder={text("Next steps, viewing details, a note for the team…")}/></label><p className="small muted">{text("Agree on a time with the customer before scheduling. Confirmed times and customer updates appear in their account. No email is sent; contact guests directly.")}</p>{error&&<div className="form-error" role="alert">{text(error)}</div>}<footer className="gw-editor-actions"><button data-button-variant="cancel" type="button" className="button button-outline" disabled={busy} onClick={()=>setLead(null)}>{text("Cancel")}</button><button data-button-variant="save" className="button" disabled={busy}><Save size={17}/>{busy?text("Saving…"):text("Save conversation")}</button>{canDeleteContent(site.staffRole)&&<button data-button-variant="danger" type="button" className="button button-outline button-danger-outline" disabled={busy} onClick={()=>{setDeleteError("");setPendingDelete({kind:"enquiry",id:lead.id,label:lead.name+" · "+lead.email});}}><Trash2 size={16}/>{text("Delete enquiry")}</button>}</footer></form></EditorModal>}</AnimatePresence>
  </>}</StudioShell>;
}

function ImageUpload({value,onChange,upload}:{value:string;onChange:(url:string)=>void;upload:(file:File)=>Promise<string>}) {
  const text=useStudioText();
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  return <div className="single-image-upload">{value&&<img src={value} alt={text("Current image")}/>}<label className="upload-label"><Upload size={17}/>{busy?text("Uploading…"):text("Upload image")}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);setError("");try{const url=await upload(file);if(active.current)onChange(url);}catch(e){setError(e instanceof Error?e.message:"Upload failed.");}finally{setBusy(false);}}}/></label>{error&&<p className="form-error" role="alert">{text(error)}</p>}</div>;
}
function PropertyEditor({property:p,isNew,setProperty,onSave,onCancel,neighbourhoods,upload,onPlanned,onPhotoTransfer,galleryChanged,galleryUnavailable,busy,error,renamePhotos}:{property:Property;isNew:boolean;setProperty:(next:Property|((previous:Property)=>Property))=>void;onSave:(p:Property)=>Promise<void>;onCancel:()=>void;neighbourhoods:Neighbourhood[];upload:(file:File,options?:PropertyImageUploadOptions)=>Promise<string>;onPlanned:(photo:PlannedListingPhoto)=>void|Promise<void>;onPhotoTransfer:(active:boolean)=>void;galleryChanged:boolean;galleryUnavailable:boolean;busy:boolean;error:string;renamePhotos?:PhotoRenameControls}) {
  const text=useStudioText();const {language,content,t}=useSite();
  const automaticUrl=isListingUrlAutomatic(isNew,content.properties.find(row=>row.id===p.id));
  const uploadsActive=useRef(true);const uploadController=useRef<AbortController|null>(null);
  useEffect(()=>{uploadsActive.current=true;return()=>{uploadsActive.current=false;uploadController.current?.abort();};},[]);
  const [videoUploading,setVideoUploading]=useState(false);
  const [uploading,setUploading]=useState(false);const [uploadError,setUploadError]=useState("");const [failedUploadFile,setFailedUploadFile]=useState("");const [imageUrl,setImageUrl]=useState("");
  const uploadAttempt=useRef(0);
  const [photoUpload,setPhotoUpload]=useState<{id:number;filename:string;progress:ListingPhotoUploadProgress}|null>(null);
  const [retryFiles,setRetryFiles]=useState<File[]>([]);
  async function uploadPhotos(files:File[]){
    if(!files.length||busy||uploading)return;
    if(p.images.length+files.length>40){setFailedUploadFile("");setUploadError("A listing can contain up to 40 photos.");return;}
    const controller=new AbortController();uploadController.current=controller;
    onPhotoTransfer(true);setUploading(true);setUploadError("");setFailedUploadFile("");setRetryFiles([]);
    let remaining=files;
    try{for(const file of files){
      if(!uploadsActive.current||controller.signal.aborted)break;
      const filename=imageOriginalFilename(file.name);setFailedUploadFile(filename);
      const attempt={id:++uploadAttempt.current,filename};
      setPhotoUpload({...attempt,progress:{phase:"preparing"}});
      const url=await upload(file,{listingId:p.id,onPlanned,signal:controller.signal,onProgress:progress=>{
        if(uploadsActive.current&&!controller.signal.aborted)setPhotoUpload({...attempt,progress});
      }});
      if(!uploadsActive.current||controller.signal.aborted)break;
      setProperty(previous=>previous.images.includes(url)?previous:({...previous,images:[...previous.images,url],image_filenames:addImageFilename(pruneImageFilenames(previous.images,previous.image_filenames),url,file.name)}));
      setPhotoUpload({...attempt,progress:{phase:"done"}});
      remaining=remaining.slice(1);setFailedUploadFile("");
    }}catch(error){if(uploadsActive.current&&!controller.signal.aborted){
      setUploadError(error instanceof Error?error.message:"Upload failed.");setRetryFiles(remaining);
      setPhotoUpload(previous=>previous&&({...previous,progress:{phase:"error",percent:previous.progress.phase==="uploading"?previous.progress.percent:undefined}}));
    }}finally{if(uploadsActive.current){onPhotoTransfer(false);setUploading(false);if(controller.signal.aborted)setPhotoUpload(null);}}
  }
  function cancelPhotoUpload(){uploadController.current?.abort();setUploadError("");setFailedUploadFile("");}
  function patch(key:keyof Property,value:unknown){setProperty(previous=>({...previous,[key]:value}));}
  return <form className="editor-form" onSubmit={e=>{e.preventDefault();if(!busy&&!uploading&&!videoUploading)void onSave(p);}}><div className="editor-section-title">{text("The introduction")}</div><label>{text("Property title · English")}<input value={p.title_en} onChange={e=>patch("title_en",e.target.value)} required maxLength={200}/></label><label>{text("Property title · Vietnamese")}<input value={p.title_vi} onChange={e=>patch("title_vi",e.target.value)} required maxLength={200}/></label><ListingUrlField property={p} automatic={automaticUrl}/><label>{text("Overview · English")}<textarea rows={4} value={p.overview_en||p.description_en} onChange={e=>patch("overview_en",e.target.value)} maxLength={12000}/></label><label>{text("Overview · Vietnamese")}<textarea rows={4} value={p.overview_vi||p.description_vi} onChange={e=>patch("overview_vi",e.target.value)} maxLength={12000}/></label><div className="editor-section-title">{text("The practical details")}</div><div className="form-row"><label>{text("Neighbourhood")}<SelectField value={p.district_slug} onValueChange={value=>patch("district_slug",value)}>{neighbourhoods.map(n=><option value={n.slug} key={n.slug}>{n.name}</option>)}</SelectField></label><label>{text("Property type")}<SelectField value={p.property_type} onValueChange={value=>patch("property_type",value)}>{[...RENTAL_TYPES,...(p.property_type==="Studio"?["Studio"]:[]),...(p.property_type==="House & Villa"?["House & Villa"]:[])].map(a=><option value={a} key={a}>{typeLabel(a,language)}</option>)}</SelectField></label></div><label>{text("Public location / street")}<input value={p.address} onChange={e=>patch("address",e.target.value)} required maxLength={300}/></label><label>{text("Exact map location (optional)")}<input value={p.map_address||""} onChange={e=>patch("map_address",e.target.value)} maxLength={300} placeholder={text("Full address or latitude,longitude")}/><small>{text("This location is public. Enter a full address or latitude,longitude for the exact map. Leave blank to show an approximate view of the public street / area.")}</small></label><PropertyPriceFields property={p} patch={patch}/><div className="form-row three"><label>{text("Bedrooms")}<input type="number" min="0" max="50" value={p.bedrooms} onChange={e=>patch("bedrooms",Number(e.target.value))} required/></label><label>{text("Bathrooms")}<input type="number" min="0" max="50" value={p.bathrooms??""} onChange={e=>patch("bathrooms",e.target.value===""?null:Number(e.target.value))} placeholder={text("Unconfirmed")}/></label><label>{text("Area · m²")}<input type="number" min="1" step="0.1" value={p.area_sqm??""} onChange={e=>patch("area_sqm",e.target.value===""?null:Number(e.target.value))} placeholder={text("Unconfirmed")}/></label></div><fieldset className="amenity-options"><legend>{text("Amenities")}</legend>{amenityOptions.map(a=><label key={a}><input type="checkbox" checked={p.amenities.includes(a)} onChange={()=>patch("amenities",p.amenities.includes(a)?p.amenities.filter(x=>x!==a):[...p.amenities,a])}/>{text(a)}</label>)}</fieldset><RentalPropertyFields property={p} patch={patch} isNew={isNew}/><div className="editor-section-title">{text("The real picture")}</div><PropertyPhotoGrid images={p.images} title={(language==="vi"?p.title_vi || p.title_en:p.title_en || p.title_vi)} filenames={p.image_filenames} metadata={p.image_metadata} rename={renamePhotos} disabled={busy}
    onMetadataChange={(src,changes:PhotoMetadata)=>setProperty(previous=>({...previous,image_metadata:{...previous.image_metadata,[imageFilenameKey(src)]:{...photoMetadata(src,previous.image_metadata),...changes}}}))}
    makeCover={index=>setProperty(previous=>{if(index<1||index>=previous.images.length)return previous;const images=[...previous.images];[images[0],images[index]]=[images[index],images[0]];return {...previous,images};})}
    move={(from,to)=>setProperty(previous=>{if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=previous.images.length||to>=previous.images.length||from===to)return previous;
      const images=[...previous.images];const [image]=images.splice(from,1);images.splice(to,0,image);return {...previous,images};})}
    remove={(index,src)=>setProperty(previous=>{if(previous.images[index]!==src)return previous;
      const images=previous.images.filter((_,i)=>i!==index);return {...previous,images,image_filenames:pruneImageFilenames(images,previous.image_filenames),
      ...(previous.image_metadata?{image_metadata:pruneImageMetadata(images,previous.image_metadata)}:{})};})}/>
  {galleryChanged&&<p className="form-info" role="status">{galleryUnavailable?t("Recovery protection couldn’t be confirmed. Leave the editor open until you confirm the save.","Chưa xác nhận được bảo vệ phiên khôi phục. Hãy giữ trình chỉnh sửa mở đến khi xác nhận đã lưu."):
    t("Save the listing to attach these changes. Unsaved media edits are available for recovery.","Lưu tin đăng để đính kèm thay đổi. Các chỉnh sửa tệp chưa lưu có thể được khôi phục.")}</p>}
  <label className="upload-label"><Upload size={18}/>{uploading?t("Processing photos…","Đang xử lý ảnh…"):text("Upload original photos")}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple disabled={busy||uploading} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value="";return uploadPhotos(files);}}/></label>
    {photoUpload&&<ListingPhotoUploadStatus key={photoUpload.id} progress={photoUpload.progress} filename={photoUpload.filename} cancel={cancelPhotoUpload}/>}
    {!uploading&&retryFiles.length>0&&<button type="button" className="button button-outline button-small" disabled={busy} onClick={()=>void uploadPhotos(retryFiles)}>{text("Retry upload")}</button>}<div className="image-url-input"><input type="url" aria-label={text("External photo URL")} value={imageUrl} onChange={e=>setImageUrl(e.target.value)} placeholder={text("Or add a photo URL (https://…)")}/><button className="button button-outline button-small" type="button" disabled={busy||uploading} onClick={()=>{if(busy||uploading)return;if(p.images.length>=40){setFailedUploadFile("");setUploadError("A listing can contain up to 40 photos.");return;}try{const url=new URL(imageUrl);if(url.protocol!=="https:")throw new Error();patch("images",[...p.images,url.href]);setImageUrl("");setUploadError("");setFailedUploadFile("");}catch{setFailedUploadFile("");setUploadError("Enter a valid HTTPS image URL.");}}}>{text("Add")}</button></div>{uploadError&&<div className="form-error image-upload-error" role="alert">{failedUploadFile&&<strong>{failedUploadFile}</strong>}<span>{text(uploadError)}</span></div>}<PropertyVideoField property={p} disabled={busy} onChange={url=>patch("video_url",url)} onUploadingChange={setVideoUploading}/><div className="editor-section-title">{text("Ready for its next chapter?")}</div><div className="form-row"><label>{text("Publication status")}<SelectField value={p.status} onValueChange={value=>patch("status",value)}><option value="draft">{text("Draft")}</option><option value="published">{text("Published")}</option><option value="archived">{text("Archived")}</option></SelectField></label><label>{text("Availability")}<SelectField value={p.availability} onValueChange={value=>patch("availability",value)}><option value="on_request">{text("Confirm with team")}</option><option value="available">{text("Available")}</option><option value="rented">{text("Rented")}</option></SelectField></label></div><label className="consent-label"><input type="checkbox" checked={p.featured} onChange={e=>patch("featured",e.target.checked)}/>{text("Feature as a Gary’s pick")}</label><p className="small muted">{text("Drafts and archived listings stay out of search. Rented homes are also hidden from results. No photo is deleted from storage when removed from a listing.")}</p>{error&&<div className="form-error" role="alert">{text(error)}</div>}<PropertySeoPanel property={p}/><div className="editor-actions gw-editor-actions listing-editor-actions">
    <button data-button-variant={p.status==="draft"?"save-draft":p.status==="archived"?"archive":"save"} type="submit" className="button listing-save" disabled={busy||uploading||videoUploading} aria-busy={busy||undefined}><Save size={17} aria-hidden="true"/>{busy?text("Saving…"):<><span className="listing-action-wide">{t("Save Listing","Lưu tin đăng")}</span><span className="listing-action-short">{t("Save","Lưu")}</span></>}</button>
    <button data-button-variant="cancel" type="button" className="button button-outline listing-cancel" disabled={busy||uploading||videoUploading} onClick={onCancel}>{t("Cancel","Hủy")}</button>
  </div></form>;
}
function SettingsForm({settings:s,onChange:set,onSave,upload,busy}:{settings:Settings;onChange:(next:Settings|((previous:Settings)=>Settings))=>void;onSave:(s:Settings)=>Promise<void>;upload:(file:File)=>Promise<string>;busy:boolean}) {
  const text=useStudioText();
 return <form className="admin-panel settings-form editor-form" onSubmit={e=>{e.preventDefault();void onSave(s);}}><h2>{text("The first hello")}</h2><p className="muted">{text("Edit the homepage introduction in both languages. Use a new line to separate the two headline lines.")}</p><div className="form-row"><label>{text("Headline · English")}<textarea rows={2} value={s.hero_title_en} onChange={e=>set({...s,hero_title_en:e.target.value})} required maxLength={160}/></label><label>{text("Headline · Vietnamese")}<textarea rows={2} value={s.hero_title_vi} onChange={e=>set({...s,hero_title_vi:e.target.value})} required maxLength={160}/></label></div><div className="form-row"><label>{text("Introduction · English")}<textarea rows={3} value={s.hero_text_en} onChange={e=>set({...s,hero_text_en:e.target.value})} required maxLength={1000}/></label><label>{text("Introduction · Vietnamese")}<textarea rows={3} value={s.hero_text_vi} onChange={e=>set({...s,hero_text_vi:e.target.value})} required maxLength={1000}/></label></div><label>{text("Homepage photograph")}</label><ImageUpload value={s.hero_image} onChange={hero_image=>set(previous=>({...previous,hero_image}))} upload={upload}/><h2>{text("Let’s stay in touch")}</h2><div className="form-row"><label>{text("Contact email")}<input type="email" value={s.contact_email} onChange={e=>set({...s,contact_email:e.target.value})} required maxLength={254}/></label><label>{text("Contact phone")}<input type="tel" value={s.contact_phone} onChange={e=>set({...s,contact_phone:e.target.value})} required maxLength={40}/></label></div><div className="form-row"><label>WhatsApp · +84…<input type="tel" value={s.whatsapp_phone||""} onChange={e=>set({...s,whatsapp_phone:e.target.value})}/></label><label>Zalo · +84…<input type="tel" value={s.zalo_phone||""} onChange={e=>set({...s,zalo_phone:e.target.value})}/></label></div><label>{text("Office address")}<input value={s.contact_address} onChange={e=>set({...s,contact_address:e.target.value})} required maxLength={400}/></label><HomepageSeoPanel settings={s}/><button data-button-variant="save" className="button" disabled={busy}><Save size={17}/>{busy?text("Saving…"):text("Save site settings")}</button></form>;
}
