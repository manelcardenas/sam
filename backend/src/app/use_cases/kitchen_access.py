from src.domain.entities import Kitchen
from src.domain.ports import KitchenRepository


def current_kitchen(kitchens: KitchenRepository, user_id: str) -> Kitchen:
    """The caller's kitchen, created on first use.

    **Everybody has exactly one, always.** Living alone is a household too, so
    there is no "not in a kitchen yet" state for the rest of the app to branch
    on — the first request that needs one makes it, and every later one finds it.

    Created here rather than at sign-up because sign-up is a Cognito event this
    application does not see: users arrive JIT-provisioned from a JWT (see
    `configure_user_repository`), and hanging a second side effect off that would
    put household creation in the authentication path.
    """
    kitchen = kitchens.active_kitchen_for(user_id)
    return kitchen if kitchen is not None else kitchens.create_kitchen(user_id)
