import { siteUrl } from "@/lib/seo";
export default function robots(){return {rules:{userAgent:"*",allow:"/",disallow:["/account","/admin","/login","/cart","/saved","/auth/","/api/"]},sitemap:siteUrl()+"/sitemap.xml"};}
