/**
 * 権限。個人単位で付与し、ビットの論理和で保持する。
 */
export enum Permission {
    None = 0,

    DiscordInviteView = 1 << 0,
    MemberView = 1 << 1,
    BlogEdit = 1 << 2,

    MemberManage = 1 << 3,
    MemberApprove = 1 << 4,
    MemberPermissionEdit = 1 << 5,
    MemberRoleEdit = 1 << 6,
    MemberDelete = 1 << 7,
    PageEdit = 1 << 8,

    SwitchBotControl = 1 << 9,
}

/**
 * 役職。一人が複数持てるため、こちらもビットの論理和で保持する。
 * 仮部員は役職ではなく MemberStatus で表す。
 */
export enum Role {
    None = 0,

    Member = 1 << 1,
    Other = 1 << 2,

    Executive = 1 << 3,
    Manager = 1 << 4,
    Accountant = 1 << 5,
    ChiefClerk = 1 << 6,
    ViceLeader = 1 << 7,
    Leader = 1 << 8,
}

/** 幹部を兼ねる役職 */
const EXECUTIVE_ROLES = Role.Manager | Role.Accountant | Role.ChiefClerk | Role.ViceLeader | Role.Leader;

/** 部員の標準権限 */
export const MEMBER_DEFAULT_PERMISSIONS =
    Permission.DiscordInviteView | Permission.MemberView | Permission.BlogEdit;

/** 幹部の標準権限 */
export const EXECUTIVE_DEFAULT_PERMISSIONS =
    MEMBER_DEFAULT_PERMISSIONS |
    Permission.MemberManage |
    Permission.MemberApprove |
    Permission.MemberPermissionEdit |
    Permission.MemberRoleEdit |
    Permission.MemberDelete |
    Permission.PageEdit |
    Permission.SwitchBotControl;

/** 役職ごとのデフォルト権限。ここに無い役職は権限を持たない */
const ROLE_DEFAULT_PERMISSIONS: ReadonlyMap<Role, Permission> = new Map([
    [Role.Member, MEMBER_DEFAULT_PERMISSIONS],
    [Role.Other, MEMBER_DEFAULT_PERMISSIONS],
    [Role.Executive, EXECUTIVE_DEFAULT_PERMISSIONS],
]);

/** 名簿シートの役職名から Role へのマッピング (移行スクリプトと共用) */
export const ROLE_NAMES: ReadonlyMap<string, Role> = new Map([
    ["部員", Role.Member],
    ["その他", Role.Other],
    ["幹部", Role.Executive],
    ["マネージャー", Role.Manager],
    ["会計", Role.Accountant],
    ["主務", Role.ChiefClerk],
    ["副部長", Role.ViceLeader],
    ["部長", Role.Leader],
]);

/**
 * 幹部を兼ねる役職には Executive を補う
 * @param roles 役職ビット
 * @returns 補完済みの役職ビット
 */
export function normalizeRoles(roles: Role): Role {
    if (roles & EXECUTIVE_ROLES) return roles | Role.Executive;
    return roles;
}

/**
 * 役職のデフォルト権限と個人単位の追加権限を合成する
 * @param roles 役職ビット
 * @param extra 個人単位で追加付与された権限ビット
 * @returns 実効権限ビット
 */
export function resolvePermissions(roles: Role, extra: Permission = Permission.None): Permission {
    let permissions = extra;

    for (const [role, defaults] of ROLE_DEFAULT_PERMISSIONS) {
        if (normalizeRoles(roles) & role) permissions |= defaults;
    }

    return permissions;
}

/**
 * 必要な権限をすべて持っているか
 * @param permissions 実効権限ビット
 * @param required 必要な権限ビット
 */
export function hasPermission(permissions: Permission, required: Permission): boolean {
    return (permissions & required) === required;
}
