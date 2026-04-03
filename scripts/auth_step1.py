import requests

url = 'https://sso.partnerkaart.ee/auth/realms/partner/login-actions/authenticate?execution=55eaedd7-ecb9-4c31-a77c-ab56b63796bf&client_id=partnerkaart&tab_id=Bczh65DE97c&client_data=eyJydSI6Imh0dHBzOi8vd3d3LnBhcnRuZXJrYWFydC5lZS9pc2V0ZWVuaW5kdXMvIiwicnQiOiJjb2RlIiwicm0iOiJmcmFnbWVudCIsInN0IjoiYTIxOWQ4YWQtMTRlNy00MzdlLTkyOTAtOTFjMzQ5ZDRhNzk3In0'

cookies = {
    'AUTH_SESSION_ID': 'Y0hRbEF5d09QTWYyMDgtNkNNQkFRVjg3Ljd4d3pzQmZGRUJiRnVuYUkxdFFXWlVZVXh5cy1Ed1BlWVJ1RFk4SG1lWDZFR2o1TmlrclpZYlg5Z1RLWU9EWGk1N2FfWVpyaXNpb2hwVWRRcGRNbkNn.keycloak-c868cc4f4-gnt49-21104',
    'KC_RESTART': 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..eWhRgI8AtHFLOBvz0LhfwA.NWaFK1v_we4OSWwinmgHiWfhXwAuywkFxAhuwxK0V9mSLs10nnCKJHoxtvmS5Vm4XmCDI4gHoMIsPQFe8jpuS2awDoOtr6VTpSILzQ2WTuqJPAch7nqKiHbNrOV8njBLL-EJsrj33EtCuGJ0xGIq5tTUnctgU9zfu7XYG4_i4J35gP5NqjcjBYA5V_1aHgBQWR7J-jYYp8G5lxSoSQNL5cCDrQ5rY9Qf-_DFSrUw0TcMLEPqn1rP7FEBokx5AfgTOdsW20CmevTJzwh94S4bYbSNelOea7bCLvSzXoEMo1ingEhdn2y-BfrmYmwuheuegIwfwUmgzGy28KeT3i2adD8iOV_Gviag5SQIDOh1v1o9nL7fU4m_v7PdJf6s1VAtEVannKeNFCss8Jn6E-yottw_Un9LfpmlgyzYUy37GMnBbeF6hBqEUT2NTlYQDuqR4ZDKrggtIDTgOoNU5ldH-Vfj-K1SKdxosuNv__MCBFVAULNqejom56Ww_RZM4TPuQiDkaBtYKkeHm5r8OauwzsoSlD5-sZMxw64wWxEYXJyCTreJLTqLLCbhdCPm4dOea78wSx_151q7CHCsGSU0v5DBv3ru4mS-UHD43MlMVzBq_RAONAIWIOcrcrLWOnoOTWGOMX6qwEjg9vDHSJQIBCZaax5f5OOeBE08mfw8cznzxLPXywqhg1Gd_7jZTwCAgHF364kMhUZURSJJOUq2fNdZFRqJ8FA3AoB2RkbXqoY2R_1HTwivqQEFVIpyPJoYAVA7KVDRmPMaY9Eh2MGydzMO86xx31VS9LW2exRgly1-8g0KEbV5AVPtv6NbkDHyLytVTxR2JyLiLj_KAiWwJbk5sv6QVifTlIgTqeUbYPby82qTSBHyb1CJPj9BqCGpHowC0u0eRLIWo_h_-fA4cMtVctStiYy2CAwugty687fLNcYsCey2-a-RB57Gn7iLIa2Q6i2ilfvS5zvq8c7y0FYAfGDIpcrgYpix-qP9gZlgHmjOD6PFIuUm0sgb5PbcIY_YitAK7TGM86kM4Po1nJ02jlOZzN1WePCEHHsmyV5hobvtLnZbrQfSQ_10Rzgq3sHJdXo1R0I7Q59NX0wTS-zCFWcJ5KGMeQRaDvbMJoXBbxxQdjC39J6xNhR02sY6JDzpZ7jks4IrYf8FyeLKnKZR_pJrIdqZl0L4yfDikT0.Dh63gA0c3Jx2afNL1tx9nQ',
    '_ga': 'GA1.1.1367758106.1775207469',
    '_ga_CQQGZYEYVZ': 'GS2.1.s1775207469$o1$g1$t1775207575$j58$l0$h0'
}

headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
}

try:
    response = requests.get(url, cookies=cookies, headers=headers)
    print(f"Status Code: {response.status_code}")
    print("Response headers (check for new session/cookies):", response.cookies.get_dict())
    # print(response.text) # Too long
except Exception as e:
    print(f"Error: {e}")
