from src.infra.adapters.places.geoapify_places_provider import GeoapifyPlacesProvider, _address_without_name


def test_drops_the_venue_name_leading_the_address() -> None:
    assert _address_without_name("Farggi, Carrer de Provença, 433, 08013 Barcelona", "Farggi") == "Carrer de Provença, 433, 08013 Barcelona"


def test_keeps_an_address_that_does_not_start_with_the_name() -> None:
    assert _address_without_name("Carrer de Mallorca, 401, Barcelona", "Casa Pepe") == "Carrer de Mallorca, 401, Barcelona"


def test_only_removes_the_whole_name_followed_by_a_comma() -> None:
    # "Mallorca" the bar on "Carrer de Mallorca": not a leading "Mallorca, ".
    assert _address_without_name("Carrer de Mallorca, 12", "Mallorca") == "Carrer de Mallorca, 12"


def test_missing_address_stays_missing() -> None:
    assert _address_without_name(None, "Farggi") is None


def test_places_come_out_without_the_duplicated_name() -> None:
    feature = {
        "properties": {
            "name": "Farggi",
            "place_id": "abc",
            "lat": 41.4,
            "lon": 2.17,
            "formatted": "Farggi, Carrer de Provença, 433, 08013 Barcelona",
            "categories": ["catering.cafe"],
            "distance": 77,
        }
    }
    place = GeoapifyPlacesProvider(api_key="unused")._to_place(feature)
    assert place is not None
    assert place.address == "Carrer de Provença, 433, 08013 Barcelona"
