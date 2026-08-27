import { sql } from "drizzle-orm";
import { db } from "../db";
import { normalizeProviderFamily, type CanonicalComposioToolkit } from "../composio-action-identity";
import { validateComposioConnectionSchema } from "../composio-connected-account-schema-validation";
import type { ComposioConnectedAccount } from "./composio-service";

type Queryable = { execute(query: any): Promise<any> };
export type ConnectionResolutionCode = "unavailable"|"unauthorized"|"ambiguous"|"provider_inactive"|"entity_mismatch";
export class ComposioConnectionAuthorityError extends Error {
  constructor(readonly code: ConnectionResolutionCode) { super(`Composio connected account ${code}`); this.name="ComposioConnectionAuthorityError"; }
}
export interface AuthorizedComposioConnection extends ComposioConnectedAccount { ownershipClass:"organization"|"platform"; }
function resultRows(result:any):any[]{return Array.isArray(result)?result:result?.rows??[];}

function selectAuthorityRow(input:{orgId:string;toolkit:string;requestedAccountId?:string;authorityRows:readonly any[]}):any {
  const orgId=input.orgId.trim(); if(!orgId) throw new ComposioConnectionAuthorityError("unauthorized");
  const toolkit=normalizeProviderFamily(input.toolkit);
  const eligible=input.authorityRows.filter(row=>row.toolkit===toolkit&&row.active===true&&(
    (row.ownership_class==="organization"&&row.org_id===orgId)||
    (row.ownership_class==="platform"&&row.platform_authorized===true)
  ));
  const selected=input.requestedAccountId?eligible.filter(row=>row.connected_account_id===input.requestedAccountId):eligible;
  if(!selected.length) throw new ComposioConnectionAuthorityError(input.requestedAccountId?"unauthorized":"unavailable");
  if(selected.length!==1) throw new ComposioConnectionAuthorityError("ambiguous");
  return selected[0];
}

export function legacyFirstActiveAccount(accounts: readonly ComposioConnectedAccount[], toolkit:string) {
  const family=normalizeProviderFamily(toolkit);
  return accounts.find(a=>a.toolkit_slug.toLowerCase()===family&&a.status==="ACTIVE")??null;
}

export function selectAuthorizedProviderAccount(input:{orgId:string;toolkit:string;requestedAccountId?:string;authorityRows:readonly any[];providerAccounts:readonly ComposioConnectedAccount[]}):AuthorizedComposioConnection {
  const toolkit=normalizeProviderFamily(input.toolkit);
  const authority=selectAuthorityRow(input);
  const provider=input.providerAccounts.find(account=>account.id===authority.connected_account_id&&account.toolkit_slug.toLowerCase()===toolkit);
  if(!provider||provider.status!=="ACTIVE") throw new ComposioConnectionAuthorityError("provider_inactive");
  if(authority.provider_entity_id&&authority.provider_entity_id!==provider.entity) throw new ComposioConnectionAuthorityError("entity_mismatch");
  return {...provider,ownershipClass:authority.ownership_class};
}

export async function listComposioConnectionAuthorities(input:{orgId:string;database?:Queryable;validateSchema?:()=>Promise<void>}):Promise<any[]> {
  const orgId=input.orgId.trim(); if(!orgId) throw new ComposioConnectionAuthorityError("unauthorized");
  const database=input.database??db;
  await (input.validateSchema??(()=>validateComposioConnectionSchema(database as any)))();
  return resultRows(await database.execute(sql`
    SELECT o.*,COALESCE(p.active,false) platform_authorized
    FROM composio_connected_account_ownership o
    LEFT JOIN composio_platform_account_authorizations p
      ON p.connected_account_id=o.connected_account_id AND p.org_id=${orgId}
    WHERE o.active AND (o.org_id=${orgId} OR o.ownership_class='platform')
  `));
}

export async function resolveComposioConnectionAuthority(input:{orgId:string;toolkit:string;requestedAccountId?:string;database?:Queryable;validateSchema?:()=>Promise<void>}):Promise<any> {
  const authorityRows=await listComposioConnectionAuthorities(input);
  return selectAuthorityRow({...input,authorityRows});
}

export async function resolveAuthorizedComposioConnection(input:{orgId:string;toolkit:string;requestedAccountId?:string;providerAccounts:readonly ComposioConnectedAccount[];database?:Queryable;validateSchema?:()=>Promise<void>}):Promise<AuthorizedComposioConnection>{
  const toolkit=normalizeProviderFamily(input.toolkit);
  const authority=await resolveComposioConnectionAuthority({...input,toolkit});
  return selectAuthorizedProviderAccount({...input,toolkit,authorityRows:[authority]});
}

export async function listAuthorizedComposioConnections(input:{orgId:string;providerAccounts:readonly ComposioConnectedAccount[];database?:Queryable;validateSchema?:()=>Promise<void>}):Promise<AuthorizedComposioConnection[]>{
  const output:AuthorizedComposioConnection[]=[];
  for(const toolkit of ["gmail","googlecalendar","slack","googlesheets","github","stripe"] as CanonicalComposioToolkit[]){
    const matches=input.providerAccounts.filter(a=>a.toolkit_slug.toLowerCase()===toolkit);
    for(const account of matches){try{output.push(await resolveAuthorizedComposioConnection({...input,toolkit,requestedAccountId:account.id}));}catch(error){if(!(error instanceof ComposioConnectionAuthorityError))throw error;}}
  }
  return output;
}
