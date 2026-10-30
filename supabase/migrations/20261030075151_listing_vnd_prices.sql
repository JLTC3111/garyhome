begin;

-- The existing price/price_max columns remain USD; VND quotes are independent.
alter table public.properties
  add column price_vnd numeric(15,0) check (price_vnd >= 0 and price_vnd < 'Infinity'::numeric),
  add column price_vnd_max numeric(15,0);
alter table public.properties add constraint properties_vnd_price_range_check check (
  price_vnd_max is null or (
    price_vnd is not null and price_vnd_max >= price_vnd and price_vnd_max < 'Infinity'::numeric
  )
);
comment on column public.properties.price_vnd is 'Optional fixed or lower VND rental price, entered independently of USD.';
comment on column public.properties.price_vnd_max is 'Optional upper VND rental price; requires price_vnd.';

notify pgrst, 'reload schema';
commit;
