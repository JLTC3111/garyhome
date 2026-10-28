-- Private, bilingual onboarding resources. Only the current owner can publish
-- or upload. Existing customer/staff membership helpers remain authoritative.
create table public.portal_guides (
 id uuid primary key default gen_random_uuid(),
 title_en text not null default '' check(length(title_en)<=180), title_vi text not null default '' check(length(title_vi)<=180),
 summary_en text not null default '' check(length(summary_en)<=700), summary_vi text not null default '' check(length(summary_vi)<=700),
 body_en text not null default '' check(length(body_en)<=16000), body_vi text not null default '' check(length(body_vi)<=16000),
 audience text not null default 'staff' check(audience in ('customer','staff','both')),
 minimum_role text check(minimum_role in ('editor','manager','admin','owner')),
 published boolean not null default false, sort_order integer not null default 0 check(sort_order between 0 and 9999),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(audience='staff' or minimum_role is null),
 check(not published or (length(trim(title_en))>0 and length(trim(title_vi))>0))
);
create table public.portal_guide_files (
 id uuid primary key default gen_random_uuid(), guide_id uuid not null references public.portal_guides(id) on delete cascade,
 guide_version timestamptz not null,
 storage_path text not null unique check(length(storage_path)<240),
 original_name text not null check(length(original_name) between 1 and 180 and original_name !~ '[[:cntrl:]/\\]'),
 mime_type text not null check(mime_type in ('video/mp4','video/webm','video/quicktime','application/pdf','image/gif','image/webp','image/png','image/apng','image/jpeg')),
 size_bytes bigint not null check(size_bytes between 1 and 52428800), created_at timestamptz not null default now(),
 check(split_part(storage_path,'/',2)=guide_id::text and split_part(storage_path,'/',3) ~ ('^'||id::text||'\.(mp4|webm|mov|pdf|gif|webp|png|jpg)$') and split_part(storage_path,'/',4)='')
);
create index portal_guide_files_guide_idx on public.portal_guide_files(guide_id);
create index portal_guides_created_by_idx on public.portal_guides(created_by);
create index portal_guides_library_idx on public.portal_guides(audience,sort_order,created_at) where published;
alter table public.portal_guides enable row level security;
alter table public.portal_guide_files enable row level security;
revoke all on public.portal_guides,public.portal_guide_files from anon,authenticated;
grant select,insert,delete on public.portal_guides to authenticated;
grant update(title_en,title_vi,summary_en,summary_vi,body_en,body_vi,audience,minimum_role,published,sort_order,updated_at) on public.portal_guides to authenticated;
grant select,insert,update,delete on public.portal_guides to service_role;
grant select,insert,delete on public.portal_guide_files to authenticated,service_role;
create policy portal_guides_read on public.portal_guides for select to authenticated using (
 (select auth.uid()) is not null and ((select private.staff_role())='owner' or (published and (
  audience in ('customer','both') or (audience='staff' and private.staff_rank((select private.staff_role()))>=private.staff_rank(coalesce(minimum_role,'editor')))
 )))
);
create policy portal_guides_insert on public.portal_guides for insert to authenticated with check ((select private.staff_role())='owner');
create policy portal_guides_update on public.portal_guides for update to authenticated using ((select private.staff_role())='owner') with check ((select private.staff_role())='owner');
create policy portal_guides_delete on public.portal_guides for delete to authenticated using ((select private.staff_role())='owner');
create policy portal_guide_files_read on public.portal_guide_files for select to authenticated using (exists(select 1 from public.portal_guides g where g.id=guide_id));
create policy portal_guide_files_insert on public.portal_guide_files for insert to authenticated with check (
 (select private.staff_role())='owner' and split_part(storage_path,'/',1)=(select auth.uid())::text and exists(select 1 from public.portal_guides g where g.id=guide_id)
);
create policy portal_guide_files_delete on public.portal_guide_files for delete to authenticated using ((select private.staff_role())='owner');

create function private.stamp_portal_guide() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.created_by:=auth.uid();new.created_at:=clock_timestamp(); else new.created_at:=old.created_at; end if;
 new.updated_at:=clock_timestamp();
 if new.published and (length(trim(new.body_en))=0 or length(trim(new.body_vi))=0) and not exists(select 1 from public.portal_guide_files f where f.guide_id=new.id) then
  raise exception 'Add written instructions in both languages or upload a visual guide before publishing' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function private.stamp_portal_guide() from public,anon,authenticated;
create trigger stamp_portal_guide before insert or update on public.portal_guides for each row execute function private.stamp_portal_guide();

create function private.limit_portal_guide_files() returns trigger language plpgsql security invoker set search_path='' as $$
declare current_version timestamptz;
begin
 if auth.uid() is null or private.staff_role() is distinct from 'owner' then raise exception 'Owner access required' using errcode='42501';end if;
 -- Serialize concurrent uploads to enforce the limit across multiple tabs.
 select updated_at into current_version from public.portal_guides where id=new.guide_id for update;
 if current_version is distinct from new.guide_version then raise exception 'The guide changed during upload; review its audience before attaching this file' using errcode='40001';end if;
 if (select count(*) from public.portal_guide_files where guide_id=new.guide_id)>=12 then raise exception 'A guide supports up to 12 files' using errcode='23514';end if;
 return new;
end; $$;
revoke all on function private.limit_portal_guide_files() from public,anon,authenticated;
create trigger limit_portal_guide_files before insert on public.portal_guide_files for each row execute function private.limit_portal_guide_files();
create function private.touch_portal_guide_files() returns trigger language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
 target:=case when tg_op='DELETE' then old.guide_id else new.guide_id end;
 update public.portal_guides g set updated_at=clock_timestamp(), published=case when g.published and (length(trim(g.body_en))=0 or length(trim(g.body_vi))=0) and not exists(select 1 from public.portal_guide_files f where f.guide_id=target) then false else g.published end where g.id=target;
 return null;
end; $$;
revoke all on function private.touch_portal_guide_files() from public,anon,authenticated;
create trigger touch_portal_guide_files after insert or delete on public.portal_guide_files for each row execute function private.touch_portal_guide_files();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(
 'portal-guides','portal-guides',false,52428800,array['video/mp4','video/webm','video/quicktime','application/pdf','image/gif','image/webp','image/png','image/apng','image/jpeg']
);
create policy portal_help_objects_read on storage.objects for select to authenticated using (
 bucket_id='portal-guides' and ((select private.staff_role())='owner' or exists(select 1 from public.portal_guide_files f where f.storage_path=objects.name))
);
create policy portal_help_objects_upload on storage.objects for insert to authenticated with check (
 bucket_id='portal-guides' and (select private.staff_role())='owner' and split_part(name,'/',1)=(select auth.uid())::text
 and exists(select 1 from public.portal_guides g where g.id::text=split_part(objects.name,'/',2))
);
create policy portal_help_objects_delete on storage.objects for delete to authenticated using (bucket_id='portal-guides' and (select private.staff_role())='owner');
-- Restrictive guards keep this bucket private even if a separate application
-- in the same project has a permissive policy. Other buckets are unaffected.
create policy portal_help_anon_guard on storage.objects as restrictive for all to anon using(bucket_id<>'portal-guides') with check(bucket_id<>'portal-guides');
create policy portal_help_read_guard on storage.objects as restrictive for select to authenticated using (
 bucket_id<>'portal-guides' or ((select private.staff_role())='owner' or exists(select 1 from public.portal_guide_files f where f.storage_path=objects.name))
);
create policy portal_help_upload_guard on storage.objects as restrictive for insert to authenticated with check (
 bucket_id<>'portal-guides' or ((select private.staff_role())='owner' and split_part(name,'/',1)=(select auth.uid())::text and exists(select 1 from public.portal_guides g where g.id::text=split_part(objects.name,'/',2)))
);
create policy portal_help_update_guard on storage.objects as restrictive for update to authenticated using(bucket_id<>'portal-guides') with check(bucket_id<>'portal-guides');
create policy portal_help_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'portal-guides' or (select private.staff_role())='owner');

-- Starter guides describe existing features; the owner can edit or unpublish them.
insert into public.portal_guides(id,title_en,title_vi,summary_en,summary_vi,body_en,body_vi,audience,minimum_role,published,sort_order) values
('94e00d01-ca7d-5aad-b00b-8e5e48d996f3','Start here: your portal','Bắt đầu: cổng thông tin của bạn','Learn the navigation, language controls and safe sign-out.','Làm quen với điều hướng, ngôn ngữ và đăng xuất an toàn.','1. Choose Customer account for your home search, or Staff login for an assigned team account. A customer registration does not grant staff access.

2. Use the portal menu to open a section. On a phone, scroll or expand the navigation when needed. The language control changes between English and Vietnamese.

3. Use Refresh if a connection was interrupted. Wait for a save confirmation before leaving a form; do not repeatedly submit an uncertain write.

4. Use Sign out on a shared device. Never share your password or password-reset link.','1. Chọn Tài khoản khách hàng để tìm nhà, hoặc Đăng nhập nhân viên với tài khoản đã được cấp quyền. Đăng ký khách hàng không cấp quyền nhân viên.

2. Dùng menu trong cổng để mở từng mục. Trên điện thoại, cuộn hoặc mở phần điều hướng khi cần. Bộ chuyển ngôn ngữ cho phép chọn tiếng Anh và tiếng Việt.

3. Dùng Làm mới nếu kết nối bị gián đoạn. Đợi xác nhận lưu trước khi rời biểu mẫu; không gửi liên tục khi chưa chắc thao tác đã hoàn tất.

4. Đăng xuất khi dùng thiết bị chung. Không chia sẻ mật khẩu hoặc liên kết đặt lại mật khẩu.','both',null,true,0),
('d7369854-e9e8-566d-85b7-5c89b2274b21','Find a home and save your favourites','Tìm nhà và lưu danh sách yêu thích','Use filters and property IDs, then keep a shortlist across devices.','Dùng bộ lọc và mã tin, rồi lưu danh sách trên nhiều thiết bị.','1. Open Apartments or Find Your Rental. Filter by district, property type, bedrooms, bathrooms and budget. Requirements includes pets, gym, BBQ, lake view and other amenities.

2. If you already have a code, enter the Property / Post ID, such as GH-000005. Each listing displays its own unique ID.

3. Tap a heart to save a home. My Favourites in the header opens your shortlist; Saved homes in your customer portal shows currently published homes.

4. Homes saved before login are automatically added to your account after signing in. Use Sync browser favourites if a connection interrupted the import. Availability and rental terms must still be confirmed with the team.','1. Mở Căn hộ hoặc Tìm nhà cho thuê. Lọc theo khu vực, loại hình, phòng ngủ, phòng tắm và ngân sách. Yêu cầu riêng có thú cưng, phòng tập, BBQ, hướng hồ và các tiện nghi khác.

2. Nếu đã có mã, nhập Mã căn hộ / bài đăng, ví dụ GH-000005. Mỗi tin đều hiển thị mã riêng.

3. Nhấn trái tim để lưu nhà. Nhà yêu thích ở đầu trang mở danh sách; Nhà đã lưu trong cổng khách hàng hiển thị các tin đang được đăng.

4. Nhà lưu trước khi đăng nhập được tự động thêm vào tài khoản sau khi đăng nhập. Dùng Đồng bộ nhà yêu thích trên trình duyệt nếu kết nối bị gián đoạn. Đội ngũ vẫn cần xác nhận tình trạng và điều kiện thuê.','customer',null,true,10),
('0cf47881-2a77-58ee-b01e-68be7d8ffe19','Follow enquiries and viewing plans','Theo dõi yêu cầu và lịch xem nhà','Know what is requested, what is confirmed and how to keep details current.','Phân biệt yêu cầu và lịch đã xác nhận, đồng thời cập nhật nhu cầu.','1. Sign in before sending a request if you want it linked to your account. Use Contact to send your requirements and include the property ID.

2. Open My enquiries to see your messages and the team’s updates. Earlier guest requests are not linked to a later account automatically; contact the team for help finding them.

3. Open My viewings for requested dates and confirmed appointments. A suggested date is not a confirmed viewing. Confirmed times are shown in Hanoi time (GMT+7).

4. Use the cancellation action when a viewing is no longer needed. Update My details with your phone, neighbourhood, move-in date, budget and preferences; select Save details and wait for confirmation.','1. Đăng nhập trước khi gửi yêu cầu nếu muốn liên kết với tài khoản. Dùng Liên hệ để gửi nhu cầu và kèm mã tin.

2. Mở Yêu cầu của tôi để xem tin nhắn và cập nhật từ đội ngũ. Yêu cầu gửi khi chưa đăng nhập không tự liên kết với tài khoản tạo sau; hãy liên hệ đội ngũ để tìm lại.

3. Mở Lịch xem nhà để xem ngày mong muốn và lịch đã xác nhận. Ngày đề xuất chưa phải lịch hẹn chính thức. Giờ đã xác nhận hiển thị theo Hà Nội (GMT+7).

4. Dùng thao tác hủy khi không còn cần lịch xem. Cập nhật Thông tin của tôi với số điện thoại, khu vực, ngày chuyển vào, ngân sách và sở thích; chọn lưu và đợi xác nhận.','customer',null,true,20),
('9dbe97f5-cd9d-53b7-8a44-f7c1b7f60e8f','Share feedback and credit your helper','Gửi phản hồi và ghi nhận người hỗ trợ','Submit an experience or record who helped you find a property.','Chia sẻ trải nghiệm hoặc ghi nhận ai đã giúp bạn tìm nhà.','1. Open Feedback to choose a rating and write about your experience. Do not include private contact, financial or identity details in the public review text.

2. Publication consent is optional. Feedback appears on the home page only after consent and staff approval; your email is kept private.

3. On a property page, use Record who helped. Enter the helper’s name, channel, place and date so the team can verify assistance and commission attribution. Submission alone does not confirm a commission.

4. Open Feedback & help in your customer portal to follow your signed-in submissions and replies.','1. Mở Phản hồi, chọn số sao và viết về trải nghiệm. Không đưa thông tin liên hệ riêng, tài chính hoặc giấy tờ cá nhân vào nội dung đánh giá công khai.

2. Đồng ý công khai là tùy chọn. Phản hồi chỉ xuất hiện trên trang chủ khi bạn cho phép và được nhân viên duyệt; email được giữ riêng tư.

3. Trên trang căn nhà, chọn Ghi nhận người hỗ trợ. Nhập tên, kênh, địa điểm và ngày để đội ngũ xác minh việc hỗ trợ và hoa hồng. Gửi biểu mẫu chưa đồng nghĩa hoa hồng đã được xác nhận.

4. Mở Phản hồi & hỗ trợ trong cổng khách hàng để theo dõi bài gửi và trả lời khi đã đăng nhập.','customer',null,true,30),
('d225427f-f1b3-5853-a861-90d09922ba14','First staff login and your profile','Đăng nhập lần đầu và hồ sơ nhân viên','Use your assigned account and personalize your profile safely.','Sử dụng tài khoản được cấp và cập nhật hồ sơ an toàn.','1. Open Staff login and enter the exact email and temporary password provided by your manager, administrator or owner. There is no separate first-login page.

2. Change your temporary password after the first login. Open your profile at the bottom of the Studio sidebar, enter a new password and confirmation, then Save changes.

3. In the same profile dialog, upload a JPG, PNG, WebP or AVIF photo up to 2 MB. Wait for the success message. Your staff photo is synchronized with linked public profiles.

4. If you cannot sign in, use Forgot password or ask an authorized team manager to check your access. Reassigning an existing account does not replace its password unless explicitly requested.','1. Mở Đăng nhập nhân viên và nhập chính xác email cùng mật khẩu tạm được quản lý, quản trị viên hoặc chủ sở hữu cấp. Không có trang đăng nhập lần đầu riêng.

2. Đổi mật khẩu tạm sau lần đăng nhập đầu. Mở hồ sơ ở cuối thanh bên Studio, nhập mật khẩu mới và xác nhận, rồi Lưu thay đổi.

3. Trong cùng hộp thoại, tải ảnh JPG, PNG, WebP hoặc AVIF tối đa 2 MB. Đợi thông báo thành công. Ảnh nhân viên đồng bộ với hồ sơ công khai đã liên kết.

4. Nếu không đăng nhập được, dùng Quên mật khẩu hoặc nhờ người có quyền quản lý kiểm tra. Cấp lại quyền cho tài khoản cũ không thay mật khẩu trừ khi chọn rõ thao tác đó.','staff','editor',true,40),
('4066bb49-bc6a-5bd0-be59-c947e6e5419a','Create and update a rental listing','Tạo và cập nhật tin cho thuê','Prepare bilingual details, original images and a publishable listing.','Chuẩn bị thông tin song ngữ, ảnh gốc và tin đăng hoàn chỉnh.','1. In Rentals & content, open Listings and choose Add a property. Keep new work as a draft while preparing it.

2. Fill both language versions, the district, address, property type, bedrooms, bathrooms, floor area, price and confirmed amenities. Organize the text into overview, location and facilities.

3. Upload original property photos. The Media tab inside Listings helps manage listing images. Verify the gallery and property ID before publishing.

4. Save the listing, then check its public page. Only published rentals with a supported availability appear publicly. Owners, administrators and managers can rearrange home/listing cards; deletion is limited to owners and administrators.','1. Trong Nhà cho thuê & nội dung, mở Tin đăng và chọn Thêm bất động sản. Giữ nội dung mới ở bản nháp trong lúc chuẩn bị.

2. Điền cả hai ngôn ngữ, khu vực, địa chỉ, loại hình, phòng ngủ, phòng tắm, diện tích, giá và tiện nghi đã xác nhận. Chia nội dung thành tổng quan, vị trí và tiện nghi.

3. Tải ảnh gốc của căn nhà. Thẻ Thư viện ảnh trong Tin đăng giúp quản lý ảnh. Kiểm tra bộ ảnh và mã tin trước khi xuất bản.

4. Lưu rồi kiểm tra trang công khai. Chỉ tin cho thuê đã đăng với tình trạng phù hợp được hiển thị. Chủ sở hữu, quản trị viên và quản lý có thể sắp xếp thẻ; chỉ chủ sở hữu và quản trị viên được xóa.','staff','editor',true,50),
('01912fac-0745-5fad-aa7c-8c6cfad54f38','Manage enquiries and customers','Quản lý yêu cầu và khách hàng','Keep customer updates clear and internal notes private.','Cập nhật rõ ràng cho khách và giữ ghi chú nội bộ riêng tư.','1. Open Enquiries under Customer care. Opening an enquiry marks it as read. Review the message and property reference before changing its status.

2. Put customer-facing information in Update for the customer. Use Internal notes for team-only details. Agree a time with the customer before entering a confirmed viewing time in Hanoi time.

3. Use Customers to maintain contact details, follow-up dates and customer stages. Refresh after an interrupted save before trying again.

4. In Customer feedback, review consent and the submitted text before approving publication. Never publish private personal details. Approved, consented reviews appear automatically on the home page. Only owners and administrators can delete enquiries.','1. Mở Yêu cầu trong Chăm sóc khách hàng. Mở yêu cầu sẽ đánh dấu đã đọc. Xem lời nhắn và mã nhà trước khi đổi trạng thái.

2. Ghi thông tin dành cho khách vào Cập nhật cho khách hàng. Dùng Ghi chú nội bộ cho chi tiết chỉ dành cho đội ngũ. Thống nhất với khách trước khi nhập lịch xem đã xác nhận theo giờ Hà Nội.

3. Dùng Khách hàng để cập nhật liên hệ, ngày theo dõi và giai đoạn chăm sóc. Làm mới sau lần lưu bị gián đoạn trước khi thử lại.

4. Trong Phản hồi khách hàng, kiểm tra sự đồng ý và nội dung trước khi duyệt. Không đăng thông tin cá nhân riêng tư. Đánh giá đã được cho phép và duyệt tự xuất hiện trên trang chủ. Chỉ chủ sở hữu và quản trị viên được xóa yêu cầu.','staff','editor',true,60),
('ef6d53c4-59cd-5a0c-9fb9-308846f3de56','Update galleries, activities and articles','Cập nhật bộ ảnh, hoạt động và bài viết','Keep the public site useful, current and bilingual.','Giữ nội dung công khai hữu ích, mới và đầy đủ hai ngôn ngữ.','1. Open People & galleries for customers, team photos and feedback screenshots. Choose the correct category; customer photos belong in Customers, and review screenshots belong in Feedback gallery.

2. Open Introduced properties to review landlord submissions and attachments before creating a listing draft. Verify the supplied property details with the landlord.

3. Under Assistance & publishing, open News articles or Rental tips. Write both languages, add appropriate sources and keep unfinished work in draft.

4. Preview published content on the website after saving. Do not invent prices, availability, biographies, reviews or affiliations.','1. Mở Nhân sự & bộ ảnh để quản lý ảnh khách hàng, đội ngũ và ảnh chụp phản hồi. Chọn đúng danh mục; ảnh khách thuộc Khách hàng, ảnh chụp đánh giá thuộc Bộ ảnh phản hồi.

2. Mở Nhà được giới thiệu để xem bài gửi và tệp của chủ nhà trước khi tạo bản nháp tin đăng. Xác minh thông tin với chủ nhà.

3. Trong Hỗ trợ & xuất bản, mở Bài viết tin tức hoặc Cẩm nang thuê nhà. Viết đủ hai ngôn ngữ, thêm nguồn phù hợp và giữ nội dung chưa hoàn tất ở bản nháp.

4. Kiểm tra nội dung công khai sau khi lưu. Không tự tạo giá, tình trạng, tiểu sử, đánh giá hoặc quan hệ hợp tác không có căn cứ.','staff','editor',true,70),
('612efbba-74d8-5a68-956e-9b862c078401','Verify assistance and attribution','Xác minh hỗ trợ và ghi nhận hoa hồng','Review evidence before confirming who helped a customer.','Kiểm tra bằng chứng trước khi ghi nhận người đã hỗ trợ khách.','1. Open Assistance attribution under Assistance & publishing. Read the property reference, helper, channel, location and date supplied by the customer.

2. Ask for more details if the introduction or viewing cannot be verified. Keep sensitive evidence in internal notes.

3. Select the credited staff member or record the confirmed helper, then save a verified review only after checking the evidence. The form records attribution; it does not calculate or pay a commission.

4. This section is available to managers, administrators and the owner.','1. Mở Ghi nhận hỗ trợ trong Hỗ trợ & xuất bản. Đọc mã nhà, tên người hỗ trợ, kênh, địa điểm và ngày khách cung cấp.

2. Yêu cầu bổ sung nếu chưa xác minh được việc giới thiệu hoặc xem nhà. Giữ bằng chứng nhạy cảm trong ghi chú nội bộ.

3. Chọn nhân viên được ghi nhận hoặc nhập người hỗ trợ đã xác nhận, rồi chỉ lưu trạng thái đã xác minh sau khi kiểm tra bằng chứng. Biểu mẫu ghi nhận việc hỗ trợ; không tính hoặc thanh toán hoa hồng.

4. Mục này dành cho quản lý, quản trị viên và chủ sở hữu.','staff','manager',true,80),
('eeeb43d7-926a-5ad7-b4d4-e16856cbe331','Assign and maintain team access','Cấp và quản lý quyền đội ngũ','Understand the role hierarchy and existing-account passwords.','Hiểu cấp bậc vai trò và mật khẩu của tài khoản đã tồn tại.','1. Open Team access. The directory shows your own level and lower levels. Viewing a peer does not allow you to change their account.

2. The hierarchy is Owner → Administrator → Manager → Staff. You can create or manage only lower roles: managers can add Staff; administrators can add Managers and Staff; the owner can add all lower roles.

3. Enter the new member’s name, allowed email, role, password and confirmation. New staff accounts are automatically confirmed and should change the temporary password after first login. Share that password privately.

4. For an existing login, choose assignment and explicitly choose password replacement when needed. Review the result rather than assuming its old password changed. Disable access to revoke membership; deletion is restricted to the permitted owner/administrator actions.','1. Mở Quyền truy cập đội ngũ. Danh sách hiển thị cấp của bạn và cấp thấp hơn. Xem người cùng cấp không có nghĩa được sửa tài khoản của họ.

2. Cấp bậc: Chủ sở hữu → Quản trị viên → Quản lý → Nhân viên. Chỉ được tạo hoặc quản lý cấp thấp hơn: quản lý thêm Nhân viên; quản trị viên thêm Quản lý và Nhân viên; chủ sở hữu thêm mọi cấp thấp hơn.

3. Nhập tên, email được phép, vai trò, mật khẩu và xác nhận. Tài khoản nhân viên mới tự xác nhận và cần đổi mật khẩu tạm sau lần đăng nhập đầu. Chia sẻ mật khẩu qua kênh riêng.

4. Với tài khoản đã có, chọn cấp quyền và chọn rõ thay mật khẩu nếu cần. Kiểm tra kết quả, không mặc định mật khẩu cũ đã đổi. Vô hiệu hóa để thu hồi quyền; thao tác xóa chỉ dành cho chủ sở hữu/quản trị viên theo giới hạn hiện hành.','staff','manager',true,90),
('b24dd86a-aa2f-5ded-8b45-2afc0719e4fc','Publish visual onboarding guides','Xuất bản hướng dẫn trực quan','Upload videos, animations and PDFs for the right audience.','Tải video, hoạt ảnh và PDF cho đúng nhóm người xem.','1. In Help & onboarding, choose Manage guides and Add guide. A private draft is created. Add an English and Vietnamese title, summary and written instructions.

2. Choose Customers, Staff or Everyone signed in. Staff guides can have a minimum role so higher-level procedures are shown only to the relevant team members.

3. Upload MP4/WebM/MOV video, GIF/WebP/APNG animation, PDF or screenshots. Each file supports up to 50 MB; a guide supports up to 12 files. Large uploads show progress and can resume after temporary network failures while this page stays open.

4. Add written steps or a transcript alongside videos for accessibility. Save draft, check the preview, then Publish. Only the owner can upload, edit, publish or delete these resources. Files use private storage and temporary viewing links.','1. Trong Hướng dẫn & hội nhập, chọn Quản lý hướng dẫn và Thêm hướng dẫn. Hệ thống tạo bản nháp riêng tư. Thêm tiêu đề, tóm tắt và nội dung tiếng Anh cùng tiếng Việt.

2. Chọn Khách hàng, Nhân viên hoặc Mọi người đã đăng nhập. Hướng dẫn nhân viên có thể đặt cấp tối thiểu để quy trình dành cho cấp cao chỉ hiển thị với người phù hợp.

3. Tải video MP4/WebM/MOV, hoạt ảnh GIF/WebP/APNG, PDF hoặc ảnh chụp màn hình. Mỗi tệp tối đa 50 MB; mỗi hướng dẫn tối đa 12 tệp. Tệp lớn có tiến trình và tiếp tục sau lỗi mạng tạm khi vẫn mở trang.

4. Thêm hướng dẫn chữ hoặc bản chép lời để dễ tiếp cận. Lưu nháp, kiểm tra xem trước, rồi Xuất bản. Chỉ chủ sở hữu được tải, sửa, đăng hoặc xóa tài liệu. Tệp dùng kho riêng tư và liên kết xem có thời hạn.','staff','owner',true,100)
on conflict(id) do nothing;
