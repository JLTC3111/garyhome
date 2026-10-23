import { submitCustomerInput } from "@/lib/submission-server";
export async function POST(request:Request){return submitCustomerInput(request,"assistance");}
